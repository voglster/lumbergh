import { useRef, useEffect, useCallback } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import '@xterm/xterm/css/xterm.css'
import { useTerminalSocket } from '../hooks/useTerminalSocket'

interface TerminalProps {
  sessionName: string
  apiHost: string
  onSendReady?: (send: ((data: string) => void) | null) => void
}

export default function Terminal({ sessionName, apiHost, onSendReady }: TerminalProps) {
  const containerRef = useRef<HTMLDivElement>(null)
  const termRef = useRef<XTerm | null>(null)
  const fitAddonRef = useRef<FitAddon | null>(null)
  const sendRef = useRef<(data: string) => void>(() => {})
  const sendResizeRef = useRef<(cols: number, rows: number) => void>(() => {})

  const handleData = useCallback((data: string) => {
    termRef.current?.write(data)
  }, [])

  const { send, sendResize, isConnected, error } = useTerminalSocket({
    sessionName,
    apiHost,
    onData: handleData,
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

  // Initialize terminal
  useEffect(() => {
    if (!containerRef.current) return

    containerRef.current.innerHTML = ''

    const term = new XTerm({
      cursorBlink: true,
      fontSize: 14,
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

    return () => {
      term.dispose()
      termRef.current = null
      fitAddonRef.current = null
    }
  }, [sessionName])

  const handleFit = () => {
    if (fitAddonRef.current && termRef.current) {
      fitAddonRef.current.fit()
      sendResizeRef.current(termRef.current.cols, termRef.current.rows)
    }
  }

  return (
    <div className="h-full w-full relative flex flex-col">
      {/* Header bar */}
      <div className="flex items-center justify-between p-2 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${isConnected ? 'bg-green-500' : 'bg-red-500'}`}
          />
          <span className="text-xs text-gray-400">
            {isConnected ? 'Connected' : 'Disconnected'}
          </span>
        </div>
        <button
          onClick={handleFit}
          className="px-2 py-1 text-xs bg-gray-700 hover:bg-gray-600 rounded"
        >
          Fit
        </button>
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
