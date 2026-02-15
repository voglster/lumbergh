import { useRef, useEffect, useCallback, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useTerminalSocket } from '../hooks/useTerminalSocket'

interface TerminalProps {
  sessionName: string
  apiHost: string
  onSendReady?: (send: ((data: string) => void) | null) => void
  onFocusReady?: (focus: () => void) => void
}

export default function Terminal({ sessionName, apiHost, onSendReady, onFocusReady }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sendRef = useRef<(data: string) => void>(() => {})
  const sendResizeRef = useRef<(cols: number, rows: number) => void>(() => {})
  // Track last known dimensions for stability check
  const lastDimensionsRef = useRef<{ width: number; height: number } | null>(null)

  // Font size state with localStorage persistence
  const [fontSize, setFontSize] = useState(() => {
    const saved = localStorage.getItem('terminal-font-size')
    return saved ? parseInt(saved, 10) : 16
  })

  // Expanded header state
  const [headerExpanded, setHeaderExpanded] = useState(false)

  // Send text via backend API (uses tmux send-keys which works better with Claude Code)
  const sendViaApi = useCallback(async (text: string, sendEnter: boolean = true) => {
    try {
      await fetch(`http://${apiHost}/api/session/${sessionName}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, send_enter: sendEnter }),
      })
    } catch (err) {
      console.error('Failed to send to terminal:', err)
    }
  }, [apiHost, sessionName])

  // Send tmux window navigation commands
  const sendTmuxCommand = useCallback(async (command: string) => {
    try {
      await fetch(`http://${apiHost}/api/session/${sessionName}/tmux-command`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ command }),
      })
    } catch (err) {
      console.error('Failed to send tmux command:', err)
    }
  }, [apiHost, sessionName])

  const handleData = useCallback((data: string) => {
    termRef.current?.write(data)
  }, [])

  // Fit terminal and send resize - used on connect and container resize
  const handleFit = useCallback(() => {
    if (fitAddonRef.current && termRef.current) {
      fitAddonRef.current.fit()
      sendResizeRef.current(termRef.current.cols, termRef.current.rows)
    }
  }, [])

  // Handle connection - immediately fit to ensure correct size is sent
  const handleConnect = useCallback(() => {
    // Small delay to ensure terminal is ready
    setTimeout(() => {
      handleFit()
    }, 50)
  }, [handleFit])

  const { send, sendResize, isConnected, error } = useTerminalSocket({
    sessionName,
    apiHost,
    onData: handleData,
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

    const term = new XTerm({
      cursorBlink: true,
      fontSize: fontSize,
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      theme: {
        background: '#1a1a1a',
        foreground: '#d4d4d4',
        cursor: '#d4d4d4',
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

    return () => {
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

  // Refresh terminal when it becomes visible (handles tab switching on mobile)
  // The canvas doesn't repaint existing content when hidden/shown, so we force a refresh
  useEffect(() => {
    if (!containerRef.current) return

    const intersectionObserver = new IntersectionObserver(
      (entries) => {
        const entry = entries[0]
        if (entry?.isIntersecting && termRef.current) {
          // Small delay to ensure layout is settled
          setTimeout(() => {
            if (termRef.current) {
              // Force full redraw of all terminal content
              termRef.current.refresh(0, termRef.current.rows - 1)
              handleFit()
            }
          }, 50)
        }
      },
      { threshold: 0.1 }
    )

    intersectionObserver.observe(containerRef.current)

    return () => {
      intersectionObserver.disconnect()
    }
  }, [handleFit])

  // Update terminal font size when it changes
  useEffect(() => {
    if (termRef.current) {
      termRef.current.options.fontSize = fontSize
      handleFit()
      localStorage.setItem('terminal-font-size', String(fontSize))
    }
  }, [fontSize, handleFit])

  return (
    <div className="h-full w-full relative flex flex-col">
      {/* Header bar */}
      <div className="bg-gray-800 border-b border-gray-700">
        {/* Main row */}
        <div className="flex items-center justify-between p-2">
          <div className="flex items-center gap-2">
            <span
              className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
            />
            <span className="text-xs text-gray-400">
              {isConnected ? 'Connected' : 'Disconnected'}
            </span>
            <button
              onClick={() => sendTmuxCommand('prev-window')}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
              title="Previous tmux window"
            >
              &lt;
            </button>
            <button
              onClick={() => sendTmuxCommand('next-window')}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
              title="Next tmux window"
            >
              &gt;
            </button>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => sendRef.current('\x1b')}
              disabled={!isConnected}
              className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 disabled:bg-gray-600 disabled:opacity-50 rounded"
              title="Send Escape key"
            >
              Esc
            </button>
            <button
              onClick={() => sendRef.current('\x1b[Z')}
              disabled={!isConnected}
              className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-gray-600 disabled:opacity-50 rounded"
              title="Toggle Plan/Accept Edits mode (Shift+Tab)"
            >
              Mode
            </button>
            <button
              onClick={() => sendViaApi('1')}
              disabled={!isConnected}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded"
              title="Send 1"
            >
              1
            </button>
            <button
              onClick={handleFit}
              className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
            >
              Fit
            </button>
            <button
              onClick={() => setHeaderExpanded(!headerExpanded)}
              className={`px-2 py-1 text-xs rounded ${headerExpanded ? 'bg-gray-600' : 'bg-gray-700 hover:bg-gray-600'}`}
              title="More options"
            >
              ...
            </button>
          </div>
        </div>
        {/* Expanded row */}
        {headerExpanded && (
          <div className="flex items-center justify-between px-2 pb-2">
            {/* Font size controls - left aligned */}
            <div className="flex items-center gap-1">
              <span className="text-xs text-gray-400">Font:</span>
              <button
                onClick={() => setFontSize((s) => Math.max(8, s - 1))}
                className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
                title="Decrease font size"
              >
                -
              </button>
              <span className="text-xs text-gray-300 w-5 text-center">{fontSize}</span>
              <button
                onClick={() => setFontSize((s) => Math.min(24, s + 1))}
                className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
                title="Increase font size"
              >
                +
              </button>
            </div>
            {/* Quick buttons - right aligned */}
            <div className="flex items-center gap-2">
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
              {['1', '2', '3', '4', 'yes', '/clear'].map((text) => (
                <button
                  key={text}
                  onClick={() => {
                    sendViaApi(text)
                    setHeaderExpanded(false)
                  }}
                  disabled={!isConnected}
                  className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-50 rounded"
                >
                  {text}
                </button>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Error display */}
      {error && (
        <div className="bg-red-900/80 text-red-200 px-2 py-1 text-sm">
          {error}
        </div>
      )}

      {/* Terminal container */}
      <div ref={containerRef} className="flex-1 overflow-hidden" />
    </div>
  )
}
