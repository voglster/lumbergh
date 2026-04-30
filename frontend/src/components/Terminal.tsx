import { useRef, useEffect, useCallback, useState, memo } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { ChevronUp, ChevronDown } from 'lucide-react'
import { useTerminalSocket } from '../hooks/useTerminalSocket'
import { getApiBase } from '../config'
import { useTheme } from '../hooks/useTheme'
import TerminalHeader from './TerminalHeader'

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
}

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
}: TerminalProps) {
  const { theme } = useTheme()
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sendRef = useRef<(data: string) => void>(() => {})
  const sendResizeRef = useRef<(cols: number, rows: number) => void>(() => {})
  // Track last known dimensions for stability check
  const lastDimensionsRef = useRef<{ width: number; height: number } | null>(null)
  // Track whether a remote client resized the PTY (cleared on local re-fit)
  const remotelySizedRef = useRef(false)

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

  // Track terminal focus (for click shield on desktop)
  const [hasFocus, setHasFocus] = useState(false)

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

  // Toggle scroll mode (tmux copy-mode)
  // Uses tmux commands directly so it works regardless of the user's prefix key
  const toggleScrollMode = useCallback(() => {
    if (scrollMode) {
      sendTmuxCommand('copy-mode-cancel')
    } else {
      sendTmuxCommand('copy-mode')
    }
    setScrollMode(!scrollMode)
  }, [scrollMode, sendTmuxCommand])

  const handleData = useCallback((data: string) => {
    termRef.current?.write(data)
  }, [])

  const handleCopyMode = useCallback((active: boolean) => {
    setScrollMode(active)
  }, [])

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
      sendResizeRef.current(cols, rows)
    }
  }, [])

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
  }, [handleFit])

  const { send, sendResize, isConnected, error, sessionDead } = useTerminalSocket({
    sessionName,
    onData: handleData,
    onResizeSync: handleResizeSync,
    onCopyMode: handleCopyMode,
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
  }, [send, sendResize])

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
  useEffect(() => {
    if (!containerRef.current) return

    containerRef.current.innerHTML = ''

    const style = getComputedStyle(document.documentElement)
    const termBg = style.getPropertyValue('--terminal-bg').trim()
    const termFg = style.getPropertyValue('--terminal-fg').trim()

    // Initial xterm size must match the size we passed to the WebSocket so
    // the backend's first capture-pane snapshot lands in a correctly-sized
    // buffer. Without this, xterm starts at 80x24 default, the snapshot
    // wraps/clips, and the visible state stays mangled until manual refit.
    const cachedSize = getInitialSize()
    const term = new XTerm({
      cursorBlink: true,
      fontSize: initialFontSizeRef.current,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 0, // No xterm scrollback — tmux owns history (copy-mode); avoids buffer-overflow scroll quirks on session switch
      macOptionClickForcesSelection: true,
      cols: cachedSize?.cols,
      rows: cachedSize?.rows,
      theme: {
        background: termBg,
        foreground: termFg,
        cursor: termFg,
        selectionBackground: '#264f78',
      },
    })

    const fitAddon = new FitAddon()
    const webLinksAddon = new WebLinksAddon()

    term.loadAddon(fitAddon)
    term.loadAddon(webLinksAddon)
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
        fitAddon.fit()
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
        remotelySizedRef.current = false
        handleFit()
      }
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
          if (dx * dx + dy * dy > 25) isClick = false
        } else if (isUp(e.type) && isClick) {
          isClick = false
          fakeShift(e)
          // Replay unmodified click so tmux sees it (e.g. tab switching)
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
        fakeShift(e)
      } else if (e.button === 1 || e.button === 2) {
        // Middle-click (1): prevent tmux from seeing it so only the browser's
        // native X11 PRIMARY paste fires (avoids double-paste on Linux).
        // Right-click (2): let browser show context menu instead of tmux handling it.
        fakeShift(e)
      }
    }

    // Detect scroll-up to immediately flag copy-mode entry
    // (tmux enters copy-mode on scroll-up when mouse mode is on)
    const onWheel = (e: WheelEvent) => {
      if (e.deltaY < 0 && !scrollModeRef.current) {
        setScrollMode(true)
      }
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
    // Wheel listener for all devices (copy-mode detection)
    el?.addEventListener('wheel', onWheel, true)

    return () => {
      initialFitObserver.disconnect()
      term.element?.removeEventListener('focusin', handleFocus)
      term.element?.removeEventListener('focusout', handleBlur)
      if (el && !isTouch) {
        for (const evt of interceptEvents) el.removeEventListener(evt, onMouseEvent, true)
      }
      el?.removeEventListener('wheel', onWheel, true)
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

    const resizeObserver = new ResizeObserver((entries) => {
      const entry = entries[0]
      if (!entry) return

      const { width, height } = entry.contentRect
      const last = lastDimensionsRef.current

      // Stability check: skip if dimensions changed less than 5px
      // This prevents resize thrashing from minor fluctuations
      if (last) {
        const deltaW = Math.abs(width - last.width)
        const deltaH = Math.abs(height - last.height)
        if (deltaW < 5 && deltaH < 5) {
          return
        }
      }

      lastDimensionsRef.current = { width, height }

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
      lastDimensionsRef.current = null
      // Double RAF ensures layout is complete after display:none removal
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          handleFit()
        })
      })
      // Additional delayed fit for mobile layout settling (mobile browsers
      // can take 200-300ms to finalize layout after display:none removal)
      const timeoutId = setTimeout(handleFit, 300)
      return () => clearTimeout(timeoutId)
    }
  }, [isVisible, handleFit])

  // Handle browser/app visibility change (mobile app switching, screen lock/unlock)
  // and orientation changes - both can leave the xterm canvas in a corrupted state
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && termRef.current && isVisible) {
        lastDimensionsRef.current = null
        setTimeout(handleFit, 200)
      }
    }

    const handleOrientation = () => {
      lastDimensionsRef.current = null
      setTimeout(handleFit, 300)
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)
    window.addEventListener('orientationchange', handleOrientation)
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      window.removeEventListener('orientationchange', handleOrientation)
    }
  }, [handleFit, isVisible])

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
      <TerminalHeader
        sessionName={sessionName}
        isConnected={isConnected}
        fontSize={fontSize}
        onFontSizeChange={setFontSize}
        headerExpanded={headerExpanded}
        onHeaderExpandedChange={setHeaderExpanded}
        isTouchDevice={isTouchDevice}
        scrollMode={scrollMode}
        onToggleScrollMode={toggleScrollMode}
        onSendRaw={(data) => {
          sendRef.current(data)
          termRef.current?.focus()
        }}
        onSendViaApi={sendViaApi}
        onSendTmuxCommand={sendTmuxCommand}
        onFit={handleFit}
        onBack={onBack}
        onReset={onReset}
        onCycleSession={onCycleSession}
        showSessionDots={showSessionDots}
        showSummary={showSummary}
        onShowSummary={onShowSummary}
      />

      {/* Error display (only show if session is not dead - dead sessions have their own overlay) */}
      {error && !sessionDead && (
        <div className="bg-red-900/80 text-red-200 px-2 py-1 text-sm">{error}</div>
      )}

      {/* Session death overlay */}
      {sessionDead && (
        <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center z-20">
          <div className="text-red-400 text-lg font-semibold mb-2">Session Terminated</div>
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
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm"
            >
              Retry
            </button>
          </div>
        </div>
      )}

      {/* Scroll controls overlay - shown when in scroll mode on touch devices */}
      {isTouchDevice && scrollMode && (
        <div className="absolute right-2 top-1/2 -translate-y-1/2 flex flex-col gap-2 z-10">
          <button
            onClick={() => sendTmuxCommand('page-up')}
            className="w-14 h-14 bg-yellow-600/90 hover:bg-yellow-500 rounded-lg flex items-center justify-center shadow-lg"
            title="Page Up"
          >
            <ChevronUp size={24} />
          </button>
          <button
            onClick={() => sendTmuxCommand('page-down')}
            className="w-14 h-14 bg-yellow-600/90 hover:bg-yellow-500 rounded-lg flex items-center justify-center shadow-lg"
            title="Page Down"
          >
            <ChevronDown size={24} />
          </button>
        </div>
      )}

      {/* Terminal container with focus click shield */}
      <div
        className={`flex-1 overflow-hidden relative ${hasFocus ? 'border-2 border-blue-500/70' : 'border-2 border-transparent'}`}
      >
        {/* Floating connection indicator */}
        <div
          className={`absolute top-1 right-1 w-2 h-2 rounded-full z-10 ${
            isConnected ? 'bg-green-500' : 'bg-red-500'
          }`}
          title={isConnected ? 'Connected' : 'Disconnected'}
        />
        {/* Focus click shield - intercepts first click to focus without triggering tmux selection */}
        {!isTouchDevice && !hasFocus && (
          <div
            className="absolute inset-0 z-10 cursor-text"
            onMouseDown={(e) => {
              e.preventDefault()
              termRef.current?.focus()
            }}
          />
        )}
        <div ref={containerRef} data-testid="xterm-container" className="h-full w-full" />
      </div>
    </div>
  )
})
