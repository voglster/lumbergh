import { describe, expect, it } from 'vitest'
import { createWheelPager } from './wheelScroll'
import type { WheelAction, WheelPager, WheelSample } from './wheelScroll'

/** The module default, restated so the tests pin the tuning, not just the plumbing. */
const MIN_INTERVAL_MS = 60

/** A wheel sample with the fields a given test doesn't care about defaulted. */
function sample(
  over: Partial<WheelSample> & Pick<WheelSample, 'deltaY' | 'mouseApp'>
): WheelSample {
  return { deltaX: 0, deltaMode: 0, timeStamp: 0, ctrlKey: false, ...over }
}

/** An action tagged with the timestamp of the sample that produced it. */
interface FedAction {
  timeStamp: number
  action: WheelAction
}

/** Feed a burst of identical deltas, collecting every action returned. */
function feedBurst(
  pager: WheelPager,
  {
    deltaY,
    count,
    mouseApp,
    deltaX = 0,
    deltaMode = 0,
    ctrlKey = false,
    startMs = 0,
    stepMs = 5,
  }: {
    deltaY: number
    count: number
    mouseApp: boolean
    deltaX?: number
    deltaMode?: number
    ctrlKey?: boolean
    startMs?: number
    stepMs?: number
  }
): FedAction[] {
  const fed: FedAction[] = []
  for (let i = 0; i < count; i++) {
    const timeStamp = startMs + i * stepMs
    fed.push({
      timeStamp,
      action: pager.feed({ deltaY, deltaX, deltaMode, timeStamp, ctrlKey, mouseApp }),
    })
  }
  return fed
}

const actionsOf = (fed: FedAction[]): WheelAction[] => fed.map((f) => f.action)
const pagesOf = (fed: FedAction[]): WheelAction[] => actionsOf(fed).filter((a) => a.type === 'page')

const pageUp: WheelAction = { type: 'page', direction: 'up' }

describe('createWheelPager', () => {
  describe('panes whose app has not asked tmux for mouse reporting', () => {
    it('always yields "native" so xterm and tmux keep their own scrolling', () => {
      // This is issue #24: a plain shell must never have its wheel hijacked.
      const pager = createWheelPager()
      const fed = feedBurst(pager, { deltaY: -3, count: 100, mouseApp: false })
      expect(actionsOf(fed).every((a) => a.type === 'native')).toBe(true)
    })

    it('yields "native" even for a single large wheel notch', () => {
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: -120, mouseApp: false }))).toEqual({ type: 'native' })
    })

    it('starts from zero when a takeover begins', () => {
      // Deliberately cannot fail as written: a non-mouse-app event returns
      // before the accumulator, so there is never anything to carry. It is a
      // guard against the native path being changed to bank travel. The test
      // below is the one that catches a real leak.
      const pager = createWheelPager()
      feedBurst(pager, { deltaY: -40, count: 5, mouseApp: false })
      const action = pager.feed(sample({ deltaY: -1, timeStamp: 100, mouseApp: true }))
      expect(action).toEqual({ type: 'swallow' })
    })

    it('discards travel buffered by a takeover that ends mid-gesture', () => {
      // Claude Code exiting while a swipe is in flight. The test above cannot
      // catch a leak: it starts from mouseApp: false, and a non-mouse-app event
      // never accumulates anything, so there is nothing there to carry over.
      // Only this ordering puts real travel in the buffer before the pane goes
      // native.
      const pager = createWheelPager()
      feedBurst(pager, { deltaY: -10, count: 4, mouseApp: true, stepMs: 1 })
      expect(pager.feed(sample({ deltaY: -10, timeStamp: 10, mouseApp: false }))).toEqual({
        type: 'native',
      })
      // Back under a mouse app 5ms later - far too soon for the idle-gap reset
      // to help, so a page here would prove the stale 40px survived.
      const fed = feedBurst(pager, {
        deltaY: -10,
        count: 4,
        mouseApp: true,
        startMs: 15,
        stepMs: 1,
      })
      expect(pagesOf(fed)).toEqual([])
    })
  })

  describe('gestures that are never a transcript scroll', () => {
    it('leaves a pinch-zoom to the browser', () => {
      // macOS delivers a trackpad pinch as a wheel event with ctrlKey set.
      // Cancelling it would page the transcript and block the zoom.
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: -120, ctrlKey: true, mouseApp: true }))).toEqual({
        type: 'native',
      })
    })

    it('does not bank pinch travel toward a page', () => {
      const pager = createWheelPager()
      feedBurst(pager, { deltaY: -20, count: 5, mouseApp: true, ctrlKey: true, stepMs: 1 })
      // 100px of pinch just went by. A real 40px scroll must still be short of
      // a page. The gap clears the rate-limit floor, so a page here could only
      // come from the pinch travel having been banked.
      const action = pager.feed(sample({ deltaY: -40, timeStamp: 200, mouseApp: true }))
      expect(action).toEqual({ type: 'swallow' })
    })

    it('leaves a horizontal-dominant swipe to the browser', () => {
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: -3, deltaX: -40, mouseApp: true }))).toEqual({
        type: 'native',
      })
    })

    it('leaves a purely horizontal swipe alone rather than swallowing it', () => {
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: 0, deltaX: 40, mouseApp: true }))).toEqual({
        type: 'native',
      })
    })

    it('does not bank the incidental vertical travel of a sideways swipe', () => {
      // 30 events of 3px vertical drift is 90px - nearly two pages if counted.
      const pager = createWheelPager()
      const fed = feedBurst(pager, {
        deltaY: -3,
        deltaX: -40,
        count: 30,
        mouseApp: true,
        stepMs: 1,
      })
      expect(actionsOf(fed).every((a) => a.type === 'native')).toBe(true)
    })

    it('does not let a sideways frame wipe banked vertical travel', () => {
      const pager = createWheelPager()
      feedBurst(pager, { deltaY: -10, count: 4, mouseApp: true, stepMs: 1 })
      // One sideways-dominant frame passes straight through...
      expect(
        pager.feed(sample({ deltaY: -1, deltaX: -40, timeStamp: 10, mouseApp: true }))
      ).toEqual({ type: 'native' })
      // ...and the 40px it never contributed to is still banked.
      expect(pager.feed(sample({ deltaY: -20, timeStamp: 20, mouseApp: true }))).toEqual(pageUp)
    })

    it('still pages a gentle swipe whose frames keep drifting sideways', () => {
      // 3px of vertical travel per frame with 4px of lateral noise on half the
      // frames. The noise "dominates" on those frames, and if they cleared the
      // bank this device would never scroll at all.
      const pager = createWheelPager()
      let pages = 0
      for (let i = 0; i < 60; i++) {
        const action = pager.feed({
          deltaY: -3,
          deltaX: i % 2 === 0 ? -4 : 0,
          deltaMode: 0,
          timeStamp: i * 5,
          ctrlKey: false,
          mouseApp: true,
        })
        if (action.type === 'page') pages++
      }
      expect(pages).toBeGreaterThan(0)
    })

    it('still pages a vertical swipe that drifts slightly sideways', () => {
      const pager = createWheelPager()
      const fed = feedBurst(pager, { deltaY: -10, deltaX: -2, count: 5, mouseApp: true, stepMs: 1 })
      expect(pagesOf(fed)).toEqual([pageUp])
    })
  })

  describe('panes whose app owns the mouse (Claude Code)', () => {
    it('emits a page once a gentle trackpad swipe crosses the threshold', () => {
      // 20 events x 3px = 60px > the 50px default threshold.
      const pager = createWheelPager()
      const fed = feedBurst(pager, { deltaY: -3, count: 20, mouseApp: true })
      expect(pagesOf(fed)).toEqual([pageUp])
    })

    it('never lets a wheel event reach xterm', () => {
      const pager = createWheelPager()
      const fed = feedBurst(pager, { deltaY: -3, count: 20, mouseApp: true })
      expect(actionsOf(fed).some((a) => a.type === 'native')).toBe(false)
    })

    it('maps positive deltaY to a down page', () => {
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: 60, mouseApp: true }))).toEqual({
        type: 'page',
        direction: 'down',
      })
    })

    it('swallows travel below the threshold', () => {
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: -10, mouseApp: true }))).toEqual({ type: 'swallow' })
    })

    it('pages at exactly the threshold but not just below it', () => {
      expect(createWheelPager().feed(sample({ deltaY: -50, mouseApp: true }))).toEqual(pageUp)
      expect(createWheelPager().feed(sample({ deltaY: -49.9, mouseApp: true }))).toEqual({
        type: 'swallow',
      })
    })

    it('scales deltaMode=1 (line) deltas into pixels', () => {
      // One real Firefox notch: 3 lines x 40px = 120px.
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: -3, deltaMode: 1, mouseApp: true }))).toEqual(pageUp)
    })

    it('scales deltaMode=2 (page) deltas into pixels', () => {
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: -1, deltaMode: 2, mouseApp: true }))).toEqual(pageUp)
    })

    it('treats an unrecognized deltaMode as pixels', () => {
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: -60, deltaMode: 99, mouseApp: true }))).toEqual(pageUp)
    })

    it('pages a line-mode wheel whose notch is below the threshold, at any cadence', () => {
      // 1 line = 40px, under the 50px threshold, so this device scrolls only if
      // banked travel survives between notches. An idle timeout is exactly what
      // used to starve it, so this sweeps cadences up to 30s: the pager must be
      // entirely time-independent, not merely tuned to a generous timeout.
      for (const stepMs of [300, 3000, 30_000]) {
        const pager = createWheelPager()
        const fed = feedBurst(pager, {
          deltaY: -1,
          deltaMode: 1,
          count: 10,
          mouseApp: true,
          stepMs,
        })
        expect(pagesOf(fed).length).toBeGreaterThan(0)
      }
    })

    it('pages a sub-threshold pixel-mode wheel at any cadence', () => {
      // Chrome and Edge on Windows set to "one line at a time" report deltaMode
      // 0 with roughly 33px per notch, so deltaMode cannot be used to recognize
      // a discrete wheel and exempt it from the accumulator.
      for (const stepMs of [300, 3000, 30_000]) {
        const pager = createWheelPager()
        const fed = feedBurst(pager, { deltaY: -33, count: 10, mouseApp: true, stepMs })
        expect(pagesOf(fed).length).toBeGreaterThan(0)
      }
    })

    it('pages on every notch of a discrete wheel, however slow the cadence', () => {
      // Firefox on Windows and Linux: deltaMode 1, 3 lines per notch, ~300ms
      // of deliberate pause between notches. This is the starvation case - at
      // 16px per line a notch came to 48px, just under the threshold, and the
      // gesture reset then dropped it before the next notch landed, so the
      // pane never scrolled at all.
      const pager = createWheelPager()
      const fed = feedBurst(pager, {
        deltaY: -3,
        deltaMode: 1,
        count: 10,
        mouseApp: true,
        stepMs: 300,
      })
      expect(pagesOf(fed)).toEqual(Array<WheelAction>(10).fill(pageUp))
    })

    it('pages on every notch of a page-mode wheel at the same cadence', () => {
      const pager = createWheelPager()
      const fed = feedBurst(pager, {
        deltaY: -1,
        deltaMode: 2,
        count: 10,
        mouseApp: true,
        stepMs: 300,
      })
      expect(pagesOf(fed)).toEqual(Array<WheelAction>(10).fill(pageUp))
    })

    it('ignores a zero delta without disturbing the bank', () => {
      // The guard has to run before the sign check: Math.sign(0) differs from
      // the sign of a pending bank, so a zero delta would read as a reversal
      // and wipe it.
      const pager = createWheelPager()
      feedBurst(pager, { deltaY: -10, count: 4, mouseApp: true, stepMs: 1 })
      expect(pager.feed(sample({ deltaY: 0, timeStamp: 10, mouseApp: true }))).toEqual({
        type: 'swallow',
      })
      // The 40px is still banked, so 20px more crosses the threshold.
      expect(pager.feed(sample({ deltaY: -20, timeStamp: 20, mouseApp: true }))).toEqual(pageUp)
    })

    it('ignores non-finite deltas', () => {
      // Browsers never send these, but the contract is a plain object, so it is
      // wider than the DOM's. NaN fails every `<`, so an unguarded NaN would
      // fall through the threshold check and emit a spurious page.
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: Number.NaN, mouseApp: true }))).toEqual({
        type: 'swallow',
      })
      expect(pager.feed(sample({ deltaY: Number.POSITIVE_INFINITY, mouseApp: true }))).toEqual({
        type: 'swallow',
      })
    })

    it('never emits two pages closer together than minIntervalMs', () => {
      // 400 events x 5px = 2000px of travel inside 400ms: a hard flick plus its
      // inertia. Spacing is the guarantee the limiter actually makes; a page
      // count would couple the test to three constants at once.
      const pager = createWheelPager()
      const fed = feedBurst(pager, { deltaY: -5, count: 400, mouseApp: true, stepMs: 1 })
      const pages = fed.filter((f) => f.action.type === 'page')
      const gaps = pages.slice(1).map((p, i) => p.timeStamp - pages[i].timeStamp)
      expect(gaps.filter((gap) => gap < MIN_INTERVAL_MS)).toEqual([])
      // Sanity: it must still scroll, and nowhere near the 40 pages that 2000px
      // of unmetered travel would have bought.
      expect(pages.length).toBeGreaterThan(1)
      expect(pages.length).toBeLessThan(15)
    })

    it('discards rate-limited travel instead of queueing it', () => {
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: 60, mouseApp: true }))).toEqual({
        type: 'page',
        direction: 'down',
      })
      // 200px arrives while the floor is down, so it is dropped, not banked.
      expect(pager.feed(sample({ deltaY: 200, timeStamp: 10, mouseApp: true }))).toEqual({
        type: 'swallow',
      })
      // Once the floor lifts, 1px must not cash in the discarded 200px.
      expect(pager.feed(sample({ deltaY: 1, timeStamp: 61, mouseApp: true }))).toEqual({
        type: 'swallow',
      })
    })

    it('responds immediately when the gesture reverses direction', () => {
      const pager = createWheelPager()
      // Build up 40px of downward travel - not enough to emit a page.
      feedBurst(pager, { deltaY: 10, count: 4, mouseApp: true, stepMs: 1 })
      // Reverse after a 197ms pause. Nothing clears the bank on a timer, so
      // the sign check is the only thing that can drop the residue. It must
      // take a fresh 50px, and the page must be 'up' rather than being
      // cancelled out by the old downward residue.
      const fed = feedBurst(pager, {
        deltaY: -10,
        count: 6,
        mouseApp: true,
        startMs: 200,
        stepMs: 1,
      })
      expect(pagesOf(fed)).toEqual([pageUp])
    })

    it('treats a backwards clock as a gesture boundary, not as "too soon"', () => {
      // Unreachable with WheelEvent.timeStamp in one document, but the contract
      // takes a plain number. A negative gap used to read as "too soon since
      // the last page" forever, suppressing every page from then on.
      const pager = createWheelPager()
      expect(pager.feed(sample({ deltaY: -60, timeStamp: 10_000, mouseApp: true }))).toEqual(pageUp)
      const fed = feedBurst(pager, {
        deltaY: -60,
        count: 10,
        mouseApp: true,
        startMs: 0,
        stepMs: MIN_INTERVAL_MS,
      })
      expect(pagesOf(fed)).toEqual(Array<WheelAction>(10).fill(pageUp))
    })

    it('honours explicit option overrides', () => {
      const pager = createWheelPager({ pageThresholdPx: 10, minIntervalMs: 0 })
      expect(pager.feed(sample({ deltaY: -10, mouseApp: true }))).toEqual(pageUp)
    })
  })
})
