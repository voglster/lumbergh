/**
 * Wheel-event policy for the terminal pane.
 *
 * Two very different panes share one wheel handler:
 *
 * - A pane whose foreground app asked tmux for mouse reporting (Claude Code's
 *   fullscreen TUI) receives wheel reports itself. Those are coordinate
 *   sensitive and get routed to input history when the pointer sits over the
 *   prompt box, so we scroll it with PageUp/PageDown instead.
 * - Every other pane - plain shells, and fullscreen apps like `less` that never
 *   ask for the mouse - must keep the native path: xterm encodes the wheel as a
 *   mouse report, tmux enters copy-mode and scrolls its own history. xterm is
 *   created with `scrollback: 0`, so if we cancel the event nothing scrolls at
 *   all. Hijacking these panes was issue #24.
 *
 * The caller decides nothing; it just obeys the returned action.
 */

/**
 * Pixel equivalent of one unit of `deltaY`, indexed by `deltaMode`. These are
 * the de facto standard conversions (the ones `normalize-wheel` has used for a
 * decade); an unrecognized mode is treated as pixels.
 *
 * They are NOT the pane's row height and must not be "corrected" to it.
 * Firefox on Windows and Linux reports one notch as `deltaMode: 1` with
 * `deltaY: 3`, and a 16px line put that notch at 48px - just under the 50px
 * threshold - so it scrolled nothing at all while an idle timeout kept dropping
 * the residue between notches. Shrinking these values re-creates that bug.
 */
const WHEEL_DELTA_PX_BY_MODE: Record<number, number | undefined> = {
  0: 1, // DOM_DELTA_PIXEL
  1: 40, // DOM_DELTA_LINE
  2: 800, // DOM_DELTA_PAGE
}

export interface WheelPagerOptions {
  /**
   * Pixels of accumulated travel that emit one page. Tuned for macOS
   * trackpads, which fire many 1-3px events: 160px (the v0.18.7 value) meant a
   * gentle two-finger swipe never scrolled at all.
   *
   * Banked travel is only ever cleared by emitting a page, by reversing
   * direction, or by leaving the takeover - never by the passage of time. An
   * idle timeout was tried and removed: any device whose per-notch travel falls
   * below this threshold depends on residue surviving between notches, so a
   * timeout starved every such device at cadences slower than the timeout. See
   * the discrete-wheel tests for the profiles that pins down.
   *
   * The cost is that travel banked by an abandoned gesture is still credited to
   * the next gesture in the same direction, bounded by this threshold. That is
   * only tolerable because the value is small; at v0.18.7's 160px it would have
   * banked three pages' worth of trackpad travel.
   */
  pageThresholdPx?: number
  /**
   * Floor on the gap between emitted pages. macOS keeps sending inertial wheel
   * events after the fingers lift; without this a flick would fire a dozen
   * pages.
   */
  minIntervalMs?: number
}

export type PageDirection = 'up' | 'down'

export type WheelAction =
  /** Let the event through untouched - do NOT preventDefault. */
  | { type: 'native' }
  /** Consume the event and scroll the app by one page. */
  | { type: 'page'; direction: PageDirection }
  /** Consume the event but scroll nothing yet. */
  | { type: 'swallow' }

export interface WheelSample {
  deltaY: number
  /**
   * Horizontal travel. Needed to tell a vertical scroll from a sideways swipe,
   * whose incidental `deltaY` must not be read as paging.
   */
  deltaX: number
  deltaMode: number
  /** Event timestamp in ms; pass `WheelEvent.timeStamp`. */
  timeStamp: number
  /** A macOS trackpad pinch arrives as a wheel event with this set. */
  ctrlKey: boolean
  /** Did the pane's foreground app ask tmux for mouse reporting? */
  mouseApp: boolean
}

export interface WheelPager {
  feed(sample: WheelSample): WheelAction
}

export function createWheelPager(options: WheelPagerOptions = {}): WheelPager {
  const pageThresholdPx = options.pageThresholdPx ?? 50
  const minIntervalMs = options.minIntervalMs ?? 60

  let accum = 0
  let lastPageMs: number | null = null

  /**
   * Hand the event back to xterm and tmux, dropping buffered travel on the way
   * out: a takeover can end mid-gesture (Claude Code exiting), and that residue
   * must never leak into a later one.
   */
  function passThrough(): WheelAction {
    accum = 0
    return { type: 'native' }
  }

  /** Is the floor on the gap between pages still down? */
  function rateLimited(timeStamp: number): boolean {
    if (lastPageMs === null) return false
    const sincePage = timeStamp - lastPageMs
    // Same reasoning on the clock: a negative gap is a boundary, so it must not
    // read as "too soon", which would suppress every page from then on.
    return sincePage >= 0 && sincePage < minIntervalMs
  }

  function feed(sample: WheelSample): WheelAction {
    const { deltaX, deltaY, deltaMode, timeStamp, ctrlKey, mouseApp } = sample

    // Not our pane: xterm turns the wheel into a mouse report and tmux scrolls
    // its own history.
    if (!mouseApp) return passThrough()
    // Pinch-to-zoom, which macOS delivers as a wheel event with ctrlKey set and
    // a real deltaY. Cancelling it would page the transcript *and* swallow the
    // browser zoom; index.html sets no `user-scalable=no`, so zoom is meant to
    // work. A pinch is its own gesture, so it also ends any scroll in progress.
    if (ctrlKey) return passThrough()
    // One frame of a sideways swipe. This is a per-frame classification rather
    // than a gesture boundary, so it must NOT clear the bank: on a gentle swipe
    // deltaY is only 1-3px, so 2-4px of lateral noise is enough to "dominate",
    // and zeroing here let stray sideways frames wipe travel that the vertical
    // frames had banked - which starved the very device the small threshold
    // exists to serve.
    if (Math.abs(deltaX) > Math.abs(deltaY)) return { type: 'native' }

    // A non-finite delta would poison the accumulator: NaN fails every `<`
    // comparison, so it would slip past the threshold check and emit a page.
    // Zero is dropped here too, before the sign check below can read
    // Math.sign(0) as a reversal and wipe a pending bank.
    if (!Number.isFinite(deltaY) || deltaY === 0) return { type: 'swallow' }

    const px = deltaY * (WHEEL_DELTA_PX_BY_MODE[deltaMode] ?? 1)
    // A reversal should respond promptly, not spend its first pixels undoing
    // residue from the opposite direction.
    if (accum !== 0 && Math.sign(px) !== Math.sign(accum)) accum = 0
    accum += px

    if (Math.abs(accum) < pageThresholdPx) return { type: 'swallow' }

    if (rateLimited(timeStamp)) {
      // Discard the travel rather than queueing it, so inertia decays instead
      // of paying out as a burst of pages once the floor lifts.
      accum = 0
      return { type: 'swallow' }
    }

    const direction: PageDirection = accum < 0 ? 'up' : 'down'
    accum = 0
    lastPageMs = timeStamp
    return { type: 'page', direction }
  }

  return { feed }
}
