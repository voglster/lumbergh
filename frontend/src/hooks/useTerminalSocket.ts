import { useRef, useCallback, useEffect, useState } from 'react'
import { getWsBase } from '../config'

interface UseTerminalSocketOptions {
  sessionName: string
  onData: (data: string) => void
  onResizeSync?: (cols: number, rows: number) => void
  onCopyMode?: (active: boolean) => void
  onConnect?: () => void
  onDisconnect?: () => void
  // Hint for the backend so the new PTY spawns at the right size and tmux
  // doesn't reflow the agent UI through 80x24 on every session switch.
  getInitialSize?: () => { cols: number; rows: number } | null
}

interface UseTerminalSocketResult {
  send: (data: string) => void
  sendResize: (cols: number, rows: number) => void
  isConnected: boolean
  error: string | null
  sessionDead: boolean
}

export function useTerminalSocket({
  sessionName,
  onData,
  onResizeSync,
  onCopyMode,
  onConnect,
  onDisconnect,
  getInitialSize,
}: UseTerminalSocketOptions): UseTerminalSocketResult {
  const getInitialSizeRef = useRef(getInitialSize)
  useEffect(() => {
    getInitialSizeRef.current = getInitialSize
  }, [getInitialSize])
  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionDead, setSessionDead] = useState(false)
  const reconnectTimeoutRef = useRef<number | null>(null)
  const sessionDeadRef = useRef(false)
  const connectRef = useRef<() => void>(() => {})

  // Store callbacks in refs to avoid recreating connect() on every render
  const onDataRef = useRef(onData)
  const onResizeSyncRef = useRef(onResizeSync)
  const onCopyModeRef = useRef(onCopyMode)
  const onConnectRef = useRef(onConnect)
  const onDisconnectRef = useRef(onDisconnect)

  useEffect(() => {
    onDataRef.current = onData
    onResizeSyncRef.current = onResizeSync
    onCopyModeRef.current = onCopyMode
    onConnectRef.current = onConnect
    onDisconnectRef.current = onDisconnect
  }, [onData, onResizeSync, onCopyMode, onConnect, onDisconnect])

  const connect = useCallback(() => {
    // Guard against StrictMode/double-effect creating a second WebSocket while
    // the first is still CONNECTING. Without the CONNECTING check, the second
    // connect call overwrites wsRef.current with ws2 while ws1 is still in
    // flight; the backend then receives TWO register_client calls and sends
    // TWO capture-pane snapshots + TWO tmux-attach redraws, producing the
    // interleaved/half-cleared first-paint we see in the broken state.
    const existing = wsRef.current
    if (existing?.readyState === WebSocket.OPEN || existing?.readyState === WebSocket.CONNECTING) {
      return
    }

    const size = getInitialSizeRef.current?.()
    const sizeQuery =
      size && size.cols > 0 && size.rows > 0 ? `?cols=${size.cols}&rows=${size.rows}` : ''
    const wsUrl = `${getWsBase()}/session/${encodeURIComponent(sessionName)}/stream${sizeQuery}`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      // Only process if this is still the active WebSocket
      if (wsRef.current !== ws) {
        ws.close()
        return
      }
      setIsConnected(true)
      setError(null)
      onConnectRef.current?.()
    }

    ws.onmessage = (event) => {
      // Only process if this is still the active WebSocket
      if (wsRef.current !== ws) return
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'output') {
          onDataRef.current(message.data)
        } else if (message.type === 'resize_sync') {
          onResizeSyncRef.current?.(message.cols, message.rows)
        } else if (message.type === 'copy_mode') {
          onCopyModeRef.current?.(message.active)
        } else if (message.type === 'error') {
          setError(message.message)
        } else if (message.type === 'session_dead' || message.type === 'session_not_found') {
          // Session has terminated - stop reconnection attempts
          setSessionDead(true)
          sessionDeadRef.current = true
          setError(message.message)
          // Cancel any pending reconnection
          if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current)
            reconnectTimeoutRef.current = null
          }
        }
      } catch {
        // If not JSON, treat as raw output
        onDataRef.current(event.data)
      }
    }

    ws.onclose = () => {
      // Only process if this is still the active WebSocket
      if (wsRef.current !== ws) return
      setIsConnected(false)
      onDisconnectRef.current?.()
      wsRef.current = null

      // Attempt reconnect only if session is not dead
      if (!sessionDeadRef.current) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connectRef.current()
        }, 2000)
      }
    }

    ws.onerror = () => {
      // Only process if this is still the active WebSocket
      if (wsRef.current !== ws) return
      setError('WebSocket connection error')
    }

    wsRef.current = ws
  }, [sessionName])

  // Keep connectRef updated
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  const send = useCallback((data: string) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'input', data }))
    }
  }, [])

  const sendResize = useCallback((cols: number, rows: number) => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      wsRef.current.send(JSON.stringify({ type: 'resize', cols, rows }))
    }
  }, [])

  useEffect(() => {
    connect()

    // When the PWA/tab resumes (iOS standalone aggressively suspends background
    // tabs and may kill the underlying socket without firing onclose), probe
    // and reconnect if needed. Backgrounded setTimeouts may also be paused, so
    // we can't rely on the 2s onclose reconnect alone.
    const ensureConnected = () => {
      if (sessionDeadRef.current) return
      const ws = wsRef.current
      if (!ws || ws.readyState === WebSocket.CLOSED || ws.readyState === WebSocket.CLOSING) {
        if (reconnectTimeoutRef.current) {
          clearTimeout(reconnectTimeoutRef.current)
          reconnectTimeoutRef.current = null
        }
        connectRef.current()
      }
    }
    const onVisibility = () => {
      if (document.visibilityState === 'visible') ensureConnected()
    }
    const onPageShow = () => ensureConnected()
    const onOnline = () => ensureConnected()
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pageshow', onPageShow)
    window.addEventListener('online', onOnline)

    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pageshow', onPageShow)
      window.removeEventListener('online', onOnline)
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        const ws = wsRef.current
        // Set to null first so handlers exit early
        wsRef.current = null
        // Close OPEN sockets immediately. For CONNECTING sockets, schedule a
        // close once they reach OPEN — leaving them to "self-close" via the
        // wsRef.current !== ws check inside onopen worked for client-side
        // dedupe but still let the backend complete register_client and send
        // a full capture_pane_content snapshot before the close propagated.
        // That orphaned snapshot races the live socket's snapshot and is what
        // caused first-paint corruption on session switches.
        if (ws.readyState === WebSocket.OPEN) {
          ws.close()
        } else if (ws.readyState === WebSocket.CONNECTING) {
          ws.addEventListener('open', () => ws.close(), { once: true })
        }
      }
    }
  }, [connect])

  return { send, sendResize, isConnected, error, sessionDead }
}
