import { useRef, useEffect, useCallback, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useTerminalSocket } from '../hooks/useTerminalSocket'
import { useTheme } from '../hooks/useTheme'

interface TerminalProps {
  sessionName: string
  apiHost: string
  onSendReady?: (send: ((data: string) => void) | null) => void
  onFocusReady?: (focus: () => void) => void
  onBack?: () => void
  onReset?: () => void
  isVisible?: boolean
}

export default function Terminal({
  sessionName,
  apiHost,
  onSendReady,
  onFocusReady,
  onBack,
  onReset,
  isVisible = true,
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

  // Track terminal focus (for click shield on desktop)
  const [hasFocus, setHasFocus] = useState(false)

  // Detect touch device (hide scroll controls on desktop)
  const [isTouchDevice] = useState(
    () =>
      typeof window !== 'undefined' && ('ontouchstart' in window || navigator.maxTouchPoints > 0)
  )

  // Toggle scroll mode (tmux copy-mode)
  const toggleScrollMode = useCallback(() => {
    if (scrollMode) {
      sendRef.current('q') // Exit copy-mode
    } else {
      sendRef.current('\x01[') // Ctrl-A + [ to enter copy-mode
    }
    setScrollMode(!scrollMode)
  }, [scrollMode])

  // Send text via backend API (uses tmux send-keys which works better with Claude Code)
  const sendViaApi = useCallback(
    async (text: string, sendEnter: boolean = true) => {
      try {
        await fetch(`http://${apiHost}/api/session/${sessionName}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, send_enter: sendEnter }),
        })
      } catch (err) {
        console.error('Failed to send to terminal:', err)
      }
    },
    [apiHost, sessionName]
  )

  // Send tmux window navigation commands
  const sendTmuxCommand = useCallback(
    async (command: string) => {
      try {
        await fetch(`http://${apiHost}/api/session/${sessionName}/tmux-command`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ command }),
        })
      } catch (err) {
        console.error('Failed to send tmux command:', err)
      }
    },
    [apiHost, sessionName]
  )

  const handleData = useCallback((data: string) => {
    termRef.current?.write(data)
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
      sendResizeRef.current(termRef.current.cols, termRef.current.rows)
    }
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
    apiHost,
    onData: handleData,
    onResizeSync: handleResizeSync,
    onConnect: handleConnect,
  })

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

    const term = new XTerm({
      cursorBlink: true,
      fontSize: initialFontSizeRef.current,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      scrollback: 10000, // Enable native scrollback for touch scrolling
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
        // Disconnect after successful initial fit
        initialFitObserver.disconnect()
      }
    })

    initialFitObserver.observe(containerRef.current)

    term.onData((data) => {
      sendRef.current(data)
    })

    // Handle Shift+Enter to send newline (like Claude Code CLI)
    term.attachCustomKeyEventHandler((event) => {
      if (event.type === 'keydown' && event.key === 'Enter' && event.shiftKey) {
        // Send newline character instead of carriage return
        sendRef.current('\n')
        return false // Prevent default handling
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

    return () => {
      initialFitObserver.disconnect()
      term.element?.removeEventListener('focusin', handleFocus)
      term.element?.removeEventListener('focusout', handleBlur)
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
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
      {/* Header bar */}
      <div className="bg-bg-surface border-b border-border-default">
        {/* Main row */}
        <div className="flex items-center justify-between p-2">
          <div className="flex items-center gap-2">
            {onBack && (
              <>
                <button
                  onClick={onBack}
                  className="text-text-tertiary hover:text-text-primary transition-colors"
                  title="Back to Dashboard"
                >
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M10 19l-7-7m0 0l7-7m-7 7h18"
                    />
                  </svg>
                </button>
                {/* Separator */}
                <div className="w-px h-4 bg-border-subtle mx-1" />
              </>
            )}
            <button
              onClick={() => sendTmuxCommand('prev-window')}
              className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover rounded"
              title="Previous tmux window"
            >
              &lt;
            </button>
            <button
              onClick={() => sendTmuxCommand('next-window')}
              className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover rounded"
              title="Next tmux window"
            >
              &gt;
            </button>
          </div>
          <div className="flex items-center gap-2">
            {isTouchDevice && (
              <button
                onClick={toggleScrollMode}
                disabled={!isConnected}
                className={`px-2 py-1 text-xs rounded ${
                  scrollMode ? 'bg-yellow-600 hover:bg-yellow-500' : 'bg-control-bg hover:bg-control-bg-hover'
                } disabled:bg-control-bg-hover disabled:opacity-50`}
                title={scrollMode ? 'Exit scroll mode (q)' : 'Enter scroll mode (copy-mode)'}
              >
                {scrollMode ? 'Exit' : 'Scroll'}
              </button>
            )}
            <button
              onClick={() => sendRef.current('\x1b')}
              disabled={!isConnected}
              className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 disabled:bg-control-bg-hover disabled:opacity-50 rounded"
              title="Send Escape key"
            >
              Esc
            </button>
            <button
              onClick={() => sendRef.current('\x1b[Z')}
              disabled={!isConnected}
              className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-control-bg-hover disabled:opacity-50 rounded"
              title="Toggle Plan/Accept Edits mode (Shift+Tab)"
            >
              Mode
            </button>
            <button
              onClick={() => sendViaApi('1')}
              disabled={!isConnected}
              className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover disabled:opacity-50 rounded"
              title="Send 1"
            >
              1
            </button>
            <button
              onClick={handleFit}
              className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover rounded"
            >
              Fit
            </button>
            <button
              onClick={() => setHeaderExpanded(!headerExpanded)}
              className={`px-2 py-1 text-xs rounded ${headerExpanded ? 'bg-control-bg-hover' : 'bg-control-bg hover:bg-control-bg-hover'}`}
              title="More options"
            >
              ...
            </button>
          </div>
        </div>
        {/* Expanded row */}
        {headerExpanded && (
          <div className="flex items-center justify-between px-2 pb-2 overflow-x-auto scrollbar-hide">
            {/* Font size controls and reset - left aligned */}
            <div className="flex items-center gap-3 shrink-0">
              <div className="flex items-center gap-1">
                <span className="text-xs text-text-tertiary">Font:</span>
                <button
                  onClick={() => setFontSize((s) => Math.max(8, s - 1))}
                  className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover rounded"
                  title="Decrease font size"
                >
                  -
                </button>
                <span className="text-xs text-text-secondary w-5 text-center">{fontSize}</span>
                <button
                  onClick={() => setFontSize((s) => Math.min(24, s + 1))}
                  className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover rounded"
                  title="Increase font size"
                >
                  +
                </button>
              </div>
              {onReset && (
                <button
                  onClick={() => {
                    if (confirm('⚠️ Reset this session?\n\nThis will:\n• Close ALL tmux windows and terminals\n• Kill any running processes\n• Start a fresh Claude session\n\nAny unsaved work will be lost!')) {
                      onReset()
                      setHeaderExpanded(false)
                    }
                  }}
                  className="px-2 py-1 text-xs bg-yellow-700 hover:bg-yellow-600 rounded"
                  title="Reset session (close all windows and restart Claude)"
                >
                  Reset
                </button>
              )}
            </div>
            {/* Quick buttons - right aligned */}
            <div className="flex items-center gap-2 shrink-0">
              <button
                onClick={() => {
                  sendTmuxCommand('new-window')
                  setHeaderExpanded(false)
                }}
                className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 rounded"
                title="Create new tmux window"
              >
                + Window
              </button>
              {/* Exit scroll mode button - always available on touch devices as escape hatch */}
              {isTouchDevice && (
                <button
                  onClick={() => {
                    sendRef.current('q') // Exit copy-mode (sends 'q' which exits tmux copy-mode)
                    setScrollMode(false)
                    setHeaderExpanded(false)
                  }}
                  className="px-2 py-1 text-xs bg-yellow-600 hover:bg-yellow-500 rounded"
                  title="Exit scroll mode (press if stuck in scroll)"
                >
                  Exit Scroll
                </button>
              )}
              {['1', '2', '3', '4', 'yes', '/clear'].map((text) => (
                <button
                  key={text}
                  onClick={() => {
                    sendViaApi(text)
                    setHeaderExpanded(false)
                  }}
                  disabled={!isConnected}
                  className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover disabled:opacity-50 rounded"
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

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
            onClick={() => sendRef.current('\x1b[5~')} // Page Up
            className="w-14 h-14 bg-yellow-600/90 hover:bg-yellow-500 rounded-lg text-xl font-bold shadow-lg"
            title="Page Up"
          >
            ▲
          </button>
          <button
            onClick={() => sendRef.current('\x1b[6~')} // Page Down
            className="w-14 h-14 bg-yellow-600/90 hover:bg-yellow-500 rounded-lg text-xl font-bold shadow-lg"
            title="Page Down"
          >
            ▼
          </button>
        </div>
      )}

      {/* Terminal container with focus click shield */}
      <div className="flex-1 overflow-hidden relative">
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
        <div ref={containerRef} className="h-full w-full" />
      </div>
    </div>
  )
}
