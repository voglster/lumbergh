import { useRef, useEffect, useCallback, useState, memo } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { Unicode11Addon } from '@xterm/addon-unicode11'
import '@xterm/xterm/css/xterm.css'
import { useTerminalSocket } from '../hooks/useTerminalSocket'
import type { PaneState } from '../hooks/useTerminalSocket'
import { createWheelPager } from '../utils/wheelScroll'
import { getApiBase } from '../config'
import { useTheme } from '../hooks/useTheme'
import TerminalHeader from './TerminalHeader'

// Copy text to the clipboard, falling back to a hidden-textarea execCommand
// when the async Clipboard API is unavailable. Lumbergh is frequently opened
// over plain http on a LAN IP (phones/tablets), which is not a secure context,
// so navigator.clipboard is undefined there — the fallback covers that case.
async function copyToClipboard(text: string): Promise<void> {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text)
      return
    } catch {
      // Fall through to the execCommand path (e.g. permission denied)
    }
  }
  const textarea = document.createElement('textarea')
  textarea.value = text
  textarea.style.position = 'fixed'
  textarea.style.top = '0'
  textarea.style.left = '0'
  textarea.style.opacity = '0'
  document.body.appendChild(textarea)
  textarea.focus()
  textarea.select()
  try {
    if (!document.execCommand('copy')) throw new Error('execCommand copy failed')
  } finally {
    document.body.removeChild(textarea)
  }
}

interface TerminalProps {
  sessionName: string
  onSendReady?: (send: ((data: string) => void) | null) => void
  onFocusReady?: (focus: () => void) => void
  onBack?: () => void
  onReset?: () => void
  onCycleSession?: (direction: 'next' | 'prev') => void
  showSessionDots?: boolean
  isVisible?: boolean
  showSummary?: boolean
  onShowSummary?: () => void
  hideHeader?: boolean
}

// eslint-disable-next-line complexity
export default memo(function Terminal({
  sessionName,
  onSendReady,
  onFocusReady,
  onBack,
  onReset,
  onCycleSession,
  showSessionDots = true,
  isVisible = true,
  showSummary = false,
  onShowSummary,
  hideHeader = false,
}: TerminalProps) {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sendRef = useRef<(data: string) => void>(() => {})
  const sendResizeRef = useRef<(cols: number, rows: number) => void>(() => {})
  const sendRefreshRef = useRef<() => void>(() => {})
  const sendActivateRef = useRef<(cols?: number, rows?: number) => void>(() => {})
  const sendDeactivateRef = useRef<() => void>(() => {})
  // Track last-sent cols/rows so we can dedupe redundant resize sends without
  // suppressing legit small layout shifts that DO cross a column/row boundary.
  const lastSentSizeRef = useRef<{ cols: number; rows: number } | null>(null)

  // Debug HUD state — enable by running `localStorage.setItem('terminal-debug','1')`
  // in devtools then reloading. Shows xterm cols/rows, last-sent size, byte/write
  // counters, and timing of fits / first data so we can diagnose first-paint corruption.
  const debugEnabledRef = useRef(false)
  // mountedAt is a ref (not part of debugInfo state) so the very first fit/write
  // reads the correct value synchronously — setDebugInfo is async, so storing
  // mountedAt in state caused first-event timestamps to report time since page
  // load instead of time since mount.
  const mountedAtRef = useRef(0)
  const [debugInfo, setDebugInfo] = useState<{
    cols: number
    rows: number
    lastSentCols: number
    lastSentRows: number
    bytesIn: number
    writes: number
    fits: number
    firstByteMs: number | null
    firstFitMs: number | null
  }>({
    cols: 0,
    rows: 0,
    lastSentCols: 0,
    lastSentRows: 0,
    bytesIn: 0,
    writes: 0,
    fits: 0,
    firstByteMs: null,
    firstFitMs: null,
  })
  const debugInfoRef = useRef(debugInfo)
  debugInfoRef.current = debugInfo
  // Track whether a remote client resized the PTY (cleared on local re-fit)
  const remotelySizedRef = useRef(false)

  // Selection freeze: Claude Code's fullscreen TUI runs a constantly-redrawing
  // spinner/status line. Every redraw that touches the selected rows makes
  // xterm drop the selection, so a drag-select gets wiped before it can be
  // copied. While the mouse button is held we buffer incoming output here and
  // flush it on release, keeping the screen stable long enough to select.
  const suppressWritesRef = useRef(false)
  const writeQueueRef = useRef<string[]>([])

  // Font size state with localStorage persistence
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('terminal-font-size')
    return saved ? parseInt(saved, 10) : 16
  })

  // Store initial font size in ref for terminal initialization (intentionally not reactive)
  const initialFontSizeRef = useRef(fontSize)

  // Expanded header state
  const [headerExpanded, setHeaderExpanded] = useState(false)

  // Scroll mode state (tmux copy-mode)
  const [scrollMode, setScrollMode] = useState(false)
  const scrollModeRef = useRef(false)

  // Whether the pane's foreground app asked tmux for mouse reporting. Defaults
  // to false so the wheel keeps the safe native path until the backend's first
  // pane-state broadcast lands (within 250ms of connecting).
  const mouseAppRef = useRef(false)

  // Track terminal focus (for focus-border styling on desktop)
  const [hasFocus, setHasFocus] = useState(false)

  // Brief "Copied" confirmation shown after a drag-select copies to clipboard
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  useEffect(
    () => () => {
      if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
    },
    []
  )

  // Detect touch device (hide scroll controls on desktop)
  const [isTouchDevice] = useState(() => {
    if (typeof window === 'undefined') return false
    // pointer:coarse = primary input is touch (phone/tablet)
    // pointer:fine = primary input is mouse/trackpad (desktop, even with touch hardware)
    if (window.matchMedia) {
      return window.matchMedia('(pointer: coarse)').matches
    }
    return 'ontouchstart' in window || navigator.maxTouchPoints > 0
  })

  // Send text via backend API (uses tmux send-keys which works better with Claude Code)
  const sendViaApi = useCallback(
    async (text: string, sendEnter: boolean = true) => {
      try {
        await fetch(`${getApiBase()}/session/${sessionName}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, send_enter: sendEnter }),
        })
        termRef.current?.focus()
      } catch (err) {
        console.error('Failed to send to terminal:', err)
      }
    },
    [sessionName]
  )

  // Send tmux window navigation commands
  const sendTmuxCommand = useCallback(
    async (command: string) => {
      try {
        await fetch(`${getApiBase()}/session/${sessionName}/tmux-command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command }),
        })
      } catch (err) {
        console.error('Failed to send tmux command:', err)
      }
    },
    [sessionName]
  )

  const handleData = useCallback(
    (data: string) => {
      if (debugEnabledRef.current) {
        const now = performance.now()
        const info = debugInfoRef.current
        setDebugInfo({
          ...info,
          bytesIn: info.bytesIn + data.length,
          writes: info.writes + 1,
          firstByteMs: info.firstByteMs ?? now - mountedAtRef.current,
          cols: termRef.current?.cols ?? info.cols,
          rows: termRef.current?.rows ?? info.rows,
        })

        // Stash full raw chunks on window for post-hoc inspection in devtools.
        // Run window.__termRawDump() to print all captured bytes with escapes
        // visible. Capped to most recent 200 chunks per session.
        const w = window as unknown as {
          __termRaw?: Record<string, string[]>
          __termRawDump?: () => void
        }
        if (!w.__termRaw) {
          w.__termRaw = {}
          w.__termRawDump = () => {
            for (const [s, chunks] of Object.entries(w.__termRaw ?? {})) {
              console.log(
                `--- ${s} (${chunks.length} chunks, ${chunks.join('').length}B total) ---`
              )
              chunks.forEach((c, i) => console.log(`[${i}]`, JSON.stringify(c)))
            }
          }
        }
        const buf = (w.__termRaw[sessionName] ??= [])
        buf.push(data)
        if (buf.length > 200) buf.shift()

        console.log(
          `[term ${sessionName}] +${(now - mountedAtRef.current).toFixed(0)}ms write ${data.length}B (xterm ${termRef.current?.cols}x${termRef.current?.rows})`,
          data.length < 200 ? JSON.stringify(data) : `[${data.length}B — call __termRawDump()]`
        )
      }
      // While a selection drag is in progress, queue output instead of writing
      // it so the frozen screen keeps the selection intact. Flushed on release.
      if (suppressWritesRef.current) {
        writeQueueRef.current.push(data)
        return
      }
      termRef.current?.write(data)
    },
    [sessionName]
  )

  const handlePaneState = useCallback((state: PaneState) => {
    setScrollMode(state.copyMode)
    mouseAppRef.current = state.mouseApp
  }, [])

  const logFit = useCallback(
    (cols: number, rows: number, willSend: boolean) => {
      if (!debugEnabledRef.current) return
      const now = performance.now()
      const info = debugInfoRef.current
      setDebugInfo({
        ...info,
        cols,
        rows,
        lastSentCols: cols,
        lastSentRows: rows,
        fits: info.fits + 1,
        firstFitMs: info.firstFitMs ?? now - mountedAtRef.current,
      })

      console.log(
        `[term ${sessionName}] +${(now - mountedAtRef.current).toFixed(0)}ms fit -> ${cols}x${rows}${willSend ? ' (sent)' : ' (deduped)'}`
      )
    },
    [sessionName]
  )

  // Fit terminal and send resize - used on connect and container resize
  const handleFit = useCallback(() => {
    if (fitAddonRef.current && termRef.current && containerRef.current) {
      const rect = containerRef.current.getBoundingClientRect()

      // Skip fitting if container has no meaningful dimensions (hidden tab, collapsed pane, etc.)
      if (rect.width < 50 || rect.height < 50) {
        return
      }

      fitAddonRef.current.fit()
      // Force canvas repaint - needed on mobile after layout changes
      termRef.current.refresh(0, termRef.current.rows - 1)
      const cols = termRef.current.cols
      const rows = termRef.current.rows
      // Cache for the next session-switch attach so the backend can spawn the
      // new PTY at the correct size up-front (avoids the 80x24 reflow flash).
      try {
        localStorage.setItem('terminal-last-cols', String(cols))
        localStorage.setItem('terminal-last-rows', String(rows))
      } catch {
        // localStorage unavailable - non-critical
      }
      const last = lastSentSizeRef.current
      const willSend = !last || last.cols !== cols || last.rows !== rows
      if (willSend) {
        lastSentSizeRef.current = { cols, rows }
        sendResizeRef.current(cols, rows)
      }
      logFit(cols, rows, willSend)
    }
  }, [logFit])

  // Provide cached dimensions to the WebSocket so the backend can size the
  // PTY before tmux attach. Uses last-fit values; safe fallback if missing.
  const getInitialSize = useCallback(() => {
    try {
      const cols = parseInt(localStorage.getItem('terminal-last-cols') || '', 10)
      const rows = parseInt(localStorage.getItem('terminal-last-rows') || '', 10)
      if (cols > 0 && rows > 0) return { cols, rows }
    } catch {
      // localStorage unavailable
    }
    return null
  }, [])

  // Handle resize sync from another client (e.g., mobile resized while desktop is open)
  // Adjusts xterm.js to match the actual PTY size to prevent garbled rendering
  const handleResizeSync = useCallback((cols: number, rows: number) => {
    if (termRef.current) {
      remotelySizedRef.current = true
      termRef.current.resize(cols, rows)
      termRef.current.refresh(0, termRef.current.rows - 1)
    }
  }, [])

  // Handle connection - fit to ensure correct size is sent
  // Double RAF handles initial render timing, delayed call handles mobile layout settling
  const handleConnect = useCallback(() => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        handleFit()
      })
    })
    // Mobile browsers may need additional time for layout to settle
    setTimeout(handleFit, 100)
    // Force a native tmux redraw once the fit has settled. On a fresh attach
    // tmux redraws on its own, but reconnects/pooled joins to a same-size
    // session get no size-driven redraw, so decorations wouldn't repaint.
    setTimeout(() => sendRefreshRef.current(), 200)
    // Opening the session on this device makes it the active client, so the
    // shared window resizes to fit here (the phone-just-opened case).
    setTimeout(() => sendActivateRef.current(termRef.current?.cols, termRef.current?.rows), 220)
  }, [handleFit])

  const {
    send,
    sendResize,
    sendRefresh,
    sendActivate,
    sendDeactivate,
    isConnected,
    error,
    sessionDead,
  } = useTerminalSocket({
    sessionName,
    onData: handleData,
    onResizeSync: handleResizeSync,
    onPaneState: handlePaneState,
    onConnect: handleConnect,
    getInitialSize,
  })

  // Keep scrollModeRef in sync with state
  useEffect(() => {
    scrollModeRef.current = scrollMode
  }, [scrollMode])

  // Keep refs updated
  useEffect(() => {
    sendRef.current = send
    sendResizeRef.current = sendResize
    sendRefreshRef.current = sendRefresh
    sendActivateRef.current = sendActivate
    sendDeactivateRef.current = sendDeactivate
  }, [send, sendResize, sendRefresh, sendActivate, sendDeactivate])

  // Ask tmux for a full native redraw (pane + status bar + borders). Used on
  // session switch/activate and the manual Fit button, where the size often
  // doesn't change so no resize-driven redraw would otherwise fire.
  const requestRefresh = useCallback(() => {
    sendRefreshRef.current()
  }, [])

  // Claim the shared tmux window for this device, reporting our current grid so
  // the backend can size the window to us ("latest active device wins").
  const requestActivate = useCallback(() => {
    sendActivateRef.current(termRef.current?.cols, termRef.current?.rows)
  }, [])

  // The manual "Fit" control (triple-dot menu) should always produce a visible
  // repaint. handleFit only sends a resize when cols/rows actually change, so
  // pair it with a forced tmux redraw to cover the unchanged-size case.
  const handleManualFit = useCallback(() => {
    handleFit()
    setTimeout(requestRefresh, 50)
  }, [handleFit, requestRefresh])

  // Expose send function to parent
  useEffect(() => {
    onSendReady?.(isConnected ? send : null)
  }, [isConnected, send, onSendReady])

  // Expose focus function to parent
  useEffect(() => {
    onFocusReady?.(() => {
      termRef.current?.focus()
    })
  }, [onFocusReady])

  // Initialize terminal
  // eslint-disable-next-line complexity
  useEffect(() => {
    if (!containerRef.current) return

    containerRef.current.innerHTML = ''

    // This component is not keyed on sessionName, so the instance (and its
    // refs) survives a session switch even though this effect re-runs. Clear
    // the mouse-app flag so the new pane starts on the safe native path instead
    // of inheriting the old pane's takeover until the first pane-state
    // broadcast lands.
    mouseAppRef.current = false

    const style = getComputedStyle(document.documentElement)
    const termBg = style.getPropertyValue('--terminal-bg').trim()
    const termFg = style.getPropertyValue('--terminal-fg').trim()

    // Initial xterm size must match the size we passed to the WebSocket so
    // the backend's first capture-pane snapshot lands in a correctly-sized
    // buffer. Without this, xterm starts at 80x24 default, the snapshot
    // wraps/clips, and the visible state stays mangled until manual refit.
    debugEnabledRef.current = (() => {
      try {
        return localStorage.getItem('terminal-debug') === '1'
      } catch {
        return false
      }
    })()
    mountedAtRef.current = performance.now()
    if (debugEnabledRef.current) {
      console.log(`[term ${sessionName}] mount; cached=${JSON.stringify(getInitialSize())}`)
    }

    const cachedSize = getInitialSize()
    const term = new XTerm({
      cursorBlink: true,
      fontSize: initialFontSizeRef.current,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 0, // No xterm scrollback — tmux owns history (copy-mode); avoids buffer-overflow scroll quirks on session switch
      macOptionClickForcesSelection: true,
      cols: cachedSize?.cols,
      rows: cachedSize?.rows,
      logLevel: debugEnabledRef.current ? 'debug' : 'info',
      // Required so we can set term.unicode.activeVersion below (Unicode11Addon's API)
      allowProposedApi: true,
      theme: {
        background: termBg,
        foreground: termFg,
        cursor: termFg,
        selectionBackground: '#264f78',
      },
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()
    const unicode11Addon = new Unicode11Addon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
    term.loadAddon(unicode11Addon)
    // Switch xterm's character-width tables from the default Unicode v6 to v11
    // so it agrees with tmux (and any modern terminal) about how wide emoji,
    // box-drawing, and other ambiguous-width glyphs render. Width disagreement
    // is what causes the "text drawn outside the box" first-paint corruption:
    // every cursor-position sequence after an offending glyph lands one column
    // off, and tmux's redraw doesn't anchor mid-line so the drift accumulates.
    term.unicode.activeVersion = '11'
    term.open(containerRef.current)

    termRef.current = term
    fitAddonRef.current = fitAddon

    // Initial fit using ResizeObserver to ensure container has valid dimensions
    // This handles percentage-based layouts where parent dimensions may still be settling
    const initialFitObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return

      const { width, height } = entry.contentRect

      // Only fit when we have meaningful dimensions (not collapsed)
      if (width > 50 && height > 50) {
        // Use handleFit so the new cols/rows are sent to the backend.
        // Bare fitAddon.fit() here would leave xterm's grid out of sync with
        // tmux's pane size, causing garbled rendering on session attach until
        // a later resize event happens to push the dimensions through.
        handleFit()
        term.focus()
        // Disconnect after successful initial fit
        initialFitObserver.disconnect()
      }
    })

    initialFitObserver.observe(containerRef.current)

    term.onData((data) => {
      sendRef.current(data)
    })

    // Play notification sound on BEL character (e.g. task completion, `echo -e '\a'`)
    // Two-note rising chime: E5 (659Hz) → G5 (784Hz), gentle sine wave
    term.onBell(() => {
      try {
        const ctx = new AudioContext()
        const t = ctx.currentTime

        const playNote = (freq: number, start: number, duration: number) => {
          const osc = ctx.createOscillator()
          const gain = ctx.createGain()
          osc.connect(gain)
          gain.connect(ctx.destination)
          osc.frequency.value = freq
          osc.type = 'sine'
          gain.gain.setValueAtTime(0, start)
          gain.gain.linearRampToValueAtTime(0.15, start + 0.02)
          gain.gain.exponentialRampToValueAtTime(0.001, start + duration)
          osc.start(start)
          osc.stop(start + duration)
          return osc
        }

        playNote(659, t, 0.2)
        const last = playNote(784, t + 0.12, 0.25)
        last.onended = () => ctx.close()
      } catch {
        // Audio not available (e.g. autoplay policy) - silently ignore
      }
    })

    // Handle Shift+Enter to send newline (like Claude Code CLI)
    // Must return false for ALL event types (keydown, keypress, keyup) to prevent
    // xterm.js's _keyPress handler from also sending \r (carriage return/submit).
    // When the custom handler blocks only keydown, xterm.js doesn't call preventDefault(),
    // so the browser fires keypress which leaks through and sends \r to the terminal.
    term.attachCustomKeyEventHandler((event) => {
      // Ctrl+[ / Ctrl+] cycles sessions — let the window handler deal with it
      if (event.ctrlKey && (event.key === '[' || event.key === ']')) {
        return false
      }
      if (event.key === 'Enter' && event.shiftKey) {
        if (event.type === 'keydown') {
          // Send newline character instead of carriage return
          sendRef.current('\n')
        }
        return false // Block all event types for Shift+Enter
      }
      // Auto-exit scroll mode on typing (desktop only)
      // Send 'q' via WebSocket (same path as the keystroke) so tmux processes them
      // in order: 'q' exits copy-mode, then the actual character reaches the shell.
      if (
        scrollModeRef.current &&
        event.type === 'keydown' &&
        !event.ctrlKey &&
        !event.metaKey &&
        !event.altKey &&
        event.key.length === 1
      ) {
        sendRef.current('q')
        setScrollMode(false)
      }
      return true // Allow default handling for other keys
    })

    // Track focus state for click shield (desktop only)
    // Re-fit on focus only if a remote client changed the PTY size
    const handleFocus = () => {
      setHasFocus(true)
      if (remotelySizedRef.current) {
        // A previous winner shrank our grid — re-fit to our own container
        // before claiming the window so we reclaim our natural size.
        remotelySizedRef.current = false
        handleFit()
      }
      // Interacting with this device makes it the active client that drives the
      // shared tmux window size.
      requestActivate()
    }
    const handleBlur = () => setHasFocus(false)
    term.element?.addEventListener('focusin', handleFocus)
    term.element?.addEventListener('focusout', handleBlur)

    // Desktop mouse event interception (capture phase)
    // Fakes shiftKey on all left-click and right-click events so xterm.js
    // bypasses mouse reporting (to tmux) and handles text selection / context
    // menu natively. Single clicks are replayed without shiftKey so they
    // still reach tmux (e.g. clicking tmux tabs).
    const isTouch = window.matchMedia
      ? window.matchMedia('(pointer: coarse)').matches
      : 'ontouchstart' in window || navigator.maxTouchPoints > 0
    let bypass = false
    let clickStartX = 0
    let clickStartY = 0
    let isClick = false

    // Freeze/thaw output around a drag-select so it survives Claude Code's live
    // redraws: while frozen, incoming output is buffered (see handleData) and
    // flushed on thaw. We freeze only once a real drag is detected (never on a
    // plain click) and thaw on a window-level pointerup/mouseup, so a click can
    // never leave output stuck and a release outside the terminal still thaws.
    let freezeTimer: ReturnType<typeof setTimeout> | null = null
    const beginFreeze = () => {
      if (suppressWritesRef.current) return
      suppressWritesRef.current = true
      // Safety net: thaw unconditionally if no release event ever reaches us.
      if (freezeTimer) clearTimeout(freezeTimer)
      freezeTimer = setTimeout(thawAndCopy, 4000)
    }
    const thawAndCopy = () => {
      if (freezeTimer) {
        clearTimeout(freezeTimer)
        freezeTimer = null
      }
      if (!suppressWritesRef.current) return
      // Read the selection directly at release. xterm's onSelectionChange
      // reports empty mid-drag, but term.getSelection() (with a DOM-selection
      // fallback) is populated by the time the button is released.
      const selText = term.getSelection() || (window.getSelection()?.toString() ?? '')
      if (selText) {
        copyToClipboard(selText)
          .then(() => {
            setCopied(true)
            if (copiedTimerRef.current) clearTimeout(copiedTimerRef.current)
            copiedTimerRef.current = setTimeout(() => setCopied(false), 1200)
          })
          .catch((err) => {
            if (debugEnabledRef.current) console.warn(`[term ${sessionName}] copy failed`, err)
          })
          .finally(() => {
            // The execCommand fallback focuses a temp textarea; return focus.
            term.focus()
          })
      }
      suppressWritesRef.current = false
      const queued = writeQueueRef.current
      writeQueueRef.current = []
      for (const chunk of queued) term.write(chunk)
    }
    // Guaranteed thaw on release regardless of where the button comes up or
    // which branch the capture handler took. Idempotent: no-op when not frozen.
    const onWindowPointerUp = () => {
      if (suppressWritesRef.current) thawAndCopy()
    }

    // xterm.js checks different modifier keys per platform to force selection:
    //   macOS: event.altKey (+ macOptionClickForcesSelection option)
    //   Linux/Windows: event.shiftKey
    const isMac = /mac/i.test(navigator.platform) || /mac/i.test(navigator.userAgent)
    const forceSelectKey = isMac ? 'altKey' : 'shiftKey'
    const fakeShift = (e: MouseEvent | PointerEvent) => {
      Object.defineProperty(e, forceSelectKey, { get: () => true })
    }

    // Unified handler for both mouse and pointer events.
    // xterm.js 5.x uses PointerEvents when available (Mac Chrome/Safari),
    // so we must intercept those to fake shiftKey before xterm.js processes them.
    const isDown = (t: string) => t === 'mousedown' || t === 'pointerdown'
    const isMove = (t: string) => t === 'mousemove' || t === 'pointermove'
    const isUp = (t: string) => t === 'mouseup' || t === 'pointerup'

    const onMouseEvent = (e: MouseEvent | PointerEvent) => {
      if (isTouch || bypass) return
      if (e.button === 0) {
        if (isDown(e.type)) {
          clickStartX = e.clientX
          clickStartY = e.clientY
          isClick = true
        } else if (isMove(e.type) && isClick) {
          const dx = e.clientX - clickStartX
          const dy = e.clientY - clickStartY
          // Crossed the drag threshold: this is a selection, not a click. Freeze
          // output now so a spinner redraw can't wipe the in-progress selection.
          if (dx * dx + dy * dy > 25) {
            isClick = false
            beginFreeze()
          }
        } else if (isUp(e.type) && isClick) {
          // Plain click (no drag): replay it unmodified so tmux sees it (e.g.
          // tab switching). No freeze was started, so there is nothing to thaw.
          isClick = false
          fakeShift(e)
          bypass = true
          const target = e.target as Element
          target.dispatchEvent(
            new MouseEvent('mousedown', {
              bubbles: true,
              cancelable: true,
              clientX: clickStartX,
              clientY: clickStartY,
              button: 0,
              buttons: 1,
            })
          )
          target.dispatchEvent(
            new MouseEvent('mouseup', {
              bubbles: true,
              cancelable: true,
              clientX: e.clientX,
              clientY: e.clientY,
              button: 0,
              buttons: 0,
            })
          )
          bypass = false
          return
        }
        // A drag's mouseup falls through to here: fakeShift so xterm finalizes
        // the selection instead of reporting the click to tmux. Thaw + copy are
        // handled by onWindowPointerUp.
        fakeShift(e)
      } else if (e.button === 1 || e.button === 2) {
        // Middle-click (1): prevent tmux from seeing it so only the browser's
        // native X11 PRIMARY paste fires (avoids double-paste on Linux).
        // Right-click (2): let browser show context menu instead of tmux handling it.
        fakeShift(e)
      }
    }

    // Scrolling via PageUp/PageDown. Claude Code's fullscreen TUI scrolls its
    // own transcript in response to PageUp/PageDown, which is far more reliable
    // than synthesizing xterm wheel reports (coordinate-sensitive, and routed to
    // input history when the wheel lands over the prompt box). We send the key
    // sequences through the same WebSocket path as real keystrokes.
    const PAGE_UP = '\x1b[5~'
    const PAGE_DOWN = '\x1b[6~'
    // Pixels of touch-drag travel per PageUp/PageDown emitted.
    const TOUCH_PAGE_PX = 45
    const scrollByKeys = (up: boolean, count: number) => {
      if (count <= 0) return
      sendRef.current((up ? PAGE_UP : PAGE_DOWN).repeat(count))
    }

    // Desktop wheel. The pager decides whether this pane is ours to drive; see
    // utils/wheelScroll.ts. Panes that are not fullscreen mouse-mode apps get
    // 'native' and the event is left alone so xterm's mouse report reaches tmux,
    // which scrolls its own history.
    const wheelPager = createWheelPager()
    const onWheel = (e: WheelEvent) => {
      const action = wheelPager.feed({
        deltaY: e.deltaY,
        deltaX: e.deltaX,
        deltaMode: e.deltaMode,
        timeStamp: e.timeStamp,
        ctrlKey: e.ctrlKey,
        mouseApp: mouseAppRef.current,
      })
      switch (action.type) {
        case 'native':
          return
        case 'page':
          e.preventDefault()
          e.stopPropagation()
          scrollByKeys(action.direction === 'up', 1)
          return
        case 'swallow':
          // Travel banked but still short of a page: consume it so xterm does
          // not also act on the same wheel event.
          e.preventDefault()
          e.stopPropagation()
          return
        default: {
          // Exhaustiveness: a new WheelAction variant becomes a type error here
          // rather than being silently treated as 'swallow'.
          const unhandled: never = action
          void unhandled
        }
      }
    }

    // Touch-drag to scroll (mobile) → PageUp/PageDown.
    let touchLastY = 0
    let touchAccum = 0
    let touchScrolling = false

    const onTouchStart = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      touchLastY = e.touches[0].clientY
      touchAccum = 0
      touchScrolling = false
    }

    const onTouchMove = (e: TouchEvent) => {
      if (e.touches.length !== 1) return
      const { clientY } = e.touches[0]
      touchAccum += clientY - touchLastY
      touchLastY = clientY
      // Finger dragging DOWN (positive delta) reveals older content → PageUp.
      while (Math.abs(touchAccum) >= TOUCH_PAGE_PX) {
        const up = touchAccum > 0
        scrollByKeys(up, 1)
        touchAccum += up ? -TOUCH_PAGE_PX : TOUCH_PAGE_PX
        touchScrolling = true
      }
      // Only claim the gesture (blocking page scroll / pull-to-refresh) once we
      // are actually scrolling the terminal, so taps-to-focus still work.
      if (touchScrolling) e.preventDefault()
    }

    const el = term.element
    // Intercept both pointer events (used by xterm.js 5.x) and mouse events (fallback)
    const interceptEvents = [
      'pointerdown',
      'pointermove',
      'pointerup',
      'mousedown',
      'mousemove',
      'mouseup',
      'contextmenu',
    ] as const
    if (el && !isTouch) {
      for (const evt of interceptEvents) el.addEventListener(evt, onMouseEvent, true)
    }
    // Touch-drag scrolling (touch devices only). touchmove must be non-passive
    // so we can preventDefault once the gesture is recognized as a scroll.
    if (el && isTouch) {
      el.addEventListener('touchstart', onTouchStart, { passive: true })
      el.addEventListener('touchmove', onTouchMove, { passive: false })
    }
    // Wheel listener for all devices. Non-passive so preventDefault() can stop
    // xterm from also handling the wheel; capture so we run before xterm.
    el?.addEventListener('wheel', onWheel, { capture: true, passive: false })
    // Thaw on release anywhere (desktop) so a drag that ends off the terminal
    // still flushes buffered output and copies the selection.
    if (!isTouch) {
      window.addEventListener('pointerup', onWindowPointerUp)
      window.addEventListener('mouseup', onWindowPointerUp)
    }

    return () => {
      // Reset the selection-freeze state so an unmount mid-drag doesn't leave
      // the next session's terminal buffering output forever.
      if (freezeTimer) clearTimeout(freezeTimer)
      suppressWritesRef.current = false
      writeQueueRef.current = []
      initialFitObserver.disconnect()
      term.element?.removeEventListener('focusin', handleFocus)
      term.element?.removeEventListener('focusout', handleBlur)
      if (el && !isTouch) {
        for (const evt of interceptEvents) el.removeEventListener(evt, onMouseEvent, true)
      }
      if (el && isTouch) {
        el.removeEventListener('touchstart', onTouchStart)
        el.removeEventListener('touchmove', onTouchMove)
      }
      el?.removeEventListener('wheel', onWheel, true)
      if (!isTouch) {
        window.removeEventListener('pointerup', onWindowPointerUp)
        window.removeEventListener('mouseup', onWindowPointerUp)
      }
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: only recreate terminal when session changes
  }, [sessionName])

  // Auto-fit on container resize (debounced with stability check)
  useEffect(() => {
    if (!containerRef.current) return

    let timeoutId: ReturnType<typeof setTimeout> | null = null

    const resizeObserver = new ResizeObserver(() => {
      // Debounce only — dedupe is handled inside handleFit by comparing
      // computed cols/rows against the last-sent values. A pixel-delta
      // suppression here can swallow small layout shifts that DO cross a
      // column boundary, leaving xterm and tmux out of sync.
      if (timeoutId) clearTimeout(timeoutId)
      timeoutId = setTimeout(handleFit, 150)
    })

    resizeObserver.observe(containerRef.current)

    return () => {
      if (timeoutId) clearTimeout(timeoutId)
      resizeObserver.disconnect()
    }
  }, [handleFit])

  // Refresh terminal when visibility changes (handles mobile tab switching)
  // IntersectionObserver doesn't work with display:none, so we use explicit prop
  useEffect(() => {
    if (isVisible && termRef.current && containerRef.current) {
      // Reset dimension tracking so the next ResizeObserver event always triggers a refit
      // Without this, switching back to a same-sized container gets skipped by the 5px check
      // Clear the last-sent-size cache so the next handleFit re-asserts the
      // size to the backend even if cols/rows look unchanged. Visibility /
      // orientation changes can leave tmux's idea of the pane size stale.
      lastSentSizeRef.current = null
      // Double RAF ensures layout is complete after display:none removal
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          handleFit()
        })
      })
      // Additional delayed fit for mobile layout settling (mobile browsers
      // can take 200-300ms to finalize layout after display:none removal)
      const timeoutId = setTimeout(handleFit, 300)
      // Re-assert size doesn't guarantee a redraw when cols/rows are unchanged,
      // so force a native tmux redraw to bring decorations back on activate.
      const refreshId = setTimeout(requestRefresh, 350)
      // Showing the terminal here claims the shared window for this device.
      const activateId = setTimeout(requestActivate, 360)
      return () => {
        clearTimeout(timeoutId)
        clearTimeout(refreshId)
        clearTimeout(activateId)
      }
    }
  }, [isVisible, handleFit, requestRefresh, requestActivate])

  // Handle browser/app visibility change (mobile app switching, screen lock/unlock)
  // and orientation changes - both can leave the xterm canvas in a corrupted state
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (!termRef.current) return
      if (document.visibilityState === 'visible' && isVisible) {
        // Clear the last-sent-size cache so the next handleFit re-asserts the
        // size to the backend even if cols/rows look unchanged. Visibility /
        // orientation changes can leave tmux's idea of the pane size stale.
        lastSentSizeRef.current = null
        setTimeout(handleFit, 200)
        setTimeout(requestRefresh, 250)
        // Foregrounding this device reclaims the shared window size.
        setTimeout(requestActivate, 260)
      } else if (document.visibilityState === 'hidden') {
        // Backgrounded (screen off / app switched away) — stop driving the
        // shared size so another connected device can take over.
        sendDeactivateRef.current()
      }
    }

    const handleOrientation = () => {
      // Clear the last-sent-size cache so the next handleFit re-asserts the
      // size to the backend even if cols/rows look unchanged. Visibility /
      // orientation changes can leave tmux's idea of the pane size stale.
      lastSentSizeRef.current = null
      setTimeout(handleFit, 300)
      setTimeout(requestRefresh, 350)
      setTimeout(requestActivate, 360)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('orientationchange', handleOrientation)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('orientationchange', handleOrientation)
    }
  }, [handleFit, isVisible, requestRefresh, requestActivate])

  // Update terminal font size when it changes
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize
      localStorage.setItem('terminal-font-size', String(fontSize))
      // xterm needs a frame to recalculate character metrics with the new font size
      // before FitAddon can correctly compute cols/rows for the container
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          handleFit()
        })
      })
    }
  }, [fontSize, handleFit])

  // Update terminal theme when app theme changes
  useEffect(() => {
    if (termRef.current) {
      const style = getComputedStyle(document.documentElement)
      const termBg = style.getPropertyValue('--terminal-bg').trim()
      const termFg = style.getPropertyValue('--terminal-fg').trim()
      termRef.current.options.theme = {
        background: termBg,
        foreground: termFg,
        cursor: termFg,
        selectionBackground: '#264f78',
      }
      termRef.current.refresh(0, termRef.current.rows - 1)
    }
  }, [theme])

  return (
    <div className="h-full w-full relative flex flex-col">
      {!hideHeader && (
        <TerminalHeader
          sessionName={sessionName}
          isConnected={isConnected}
          fontSize={fontSize}
          onFontSizeChange={setFontSize}
          headerExpanded={headerExpanded}
          onHeaderExpandedChange={setHeaderExpanded}
          isTouchDevice={isTouchDevice}
          onSendRaw={(data) => {
            sendRef.current(data)
            termRef.current?.focus()
          }}
          onSendViaApi={sendViaApi}
          onSendTmuxCommand={sendTmuxCommand}
          onFit={handleManualFit}
          onBack={onBack}
          onReset={onReset}
          onCycleSession={onCycleSession}
          showSessionDots={showSessionDots}
          showSummary={showSummary}
          onShowSummary={onShowSummary}
        />
      )}

      {/* Error display (only show if session is not dead - dead sessions have their own overlay) */}
      {error && !sessionDead && (
        <div className="bg-danger/20 text-danger px-2 py-1 text-sm">{error}</div>
      )}

      {/* Session death overlay */}
      {sessionDead && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-20">
          <div className="text-danger text-lg font-semibold mb-2">Session Terminated</div>
          <p className="text-text-tertiary text-sm mb-4 text-center px-4">
            The tmux session has ended or was killed
          </p>
          <div className="flex gap-3">
            <button
              onClick={() => (window.location.href = '/')}
              className="px-4 py-2 bg-control-bg hover:bg-control-bg-hover rounded text-sm"
            >
              Dashboard
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-action hover:brightness-110 text-white rounded text-sm"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Terminal container with focus click shield */}
      <div
        className={`flex-1 overflow-hidden relative ${hasFocus ? 'border-2 border-action/40' : 'border-2 border-transparent'}`}
      >
        {/* Floating connection indicator */}
        <div
          className={`absolute top-1 right-1 w-2 h-2 rounded-full z-10 ${
            isConnected ? 'bg-success' : 'bg-danger'
          }`}
          title={isConnected ? 'Connected' : 'Disconnected'}
        />
        {debugEnabledRef.current && (
          <div className="absolute top-1 left-1 z-20 px-2 py-1 bg-black/80 text-[10px] font-mono text-yellow-200 rounded pointer-events-none leading-tight">
            <div>
              xterm {debugInfo.cols}x{debugInfo.rows}
            </div>
            <div>
              sent {debugInfo.lastSentCols}x{debugInfo.lastSentRows}
            </div>
            <div>
              fits {debugInfo.fits} · writes {debugInfo.writes} · {debugInfo.bytesIn}B
            </div>
            <div>
              t1B {debugInfo.firstByteMs?.toFixed(0) ?? '—'}ms · t1F{' '}
              {debugInfo.firstFitMs?.toFixed(0) ?? '—'}ms
            </div>
          </div>
        )}
        {/* Copy confirmation flash (desktop drag-select copy-on-release) */}
        {copied && (
          <div className="absolute top-1 left-1/2 -translate-x-1/2 z-20 px-2 py-0.5 bg-black/80 text-success text-xs rounded pointer-events-none">
            Copied
          </div>
        )}
        <div ref={containerRef} data-testid="xterm-container" className="h-full w-full" />
      </div>
    </div>
  )
})
