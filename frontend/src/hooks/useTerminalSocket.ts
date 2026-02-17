import { useRef, useCallback, useEffect, useState } from 'react'

interface UseTerminalSocketOptions {
  sessionName: string
  apiHost: string
  onData: (data: string) => void
  onConnect?: () => void
  onDisconnect?: () => void
}

type SessionIdleState = 'unknown' | 'idle' | 'working'

interface UseTerminalSocketResult {
  send: (data: string) => void
  sendResize: (cols: number, rows: number) => void
  isConnected: boolean
  error: string | null
  sessionDead: boolean
  idleState: SessionIdleState
}

export function useTerminalSocket({
  sessionName,
  apiHost,
  onData,
  onConnect,
  onDisconnect,
}: UseTerminalSocketOptions): UseTerminalSocketResult {
  const wsRef = useRef<WebSocket | null>(null)
  const [isConnected, setIsConnected] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [sessionDead, setSessionDead] = useState(false)
  const [idleState, setIdleState] = useState<SessionIdleState>('unknown')
  const reconnectTimeoutRef = useRef<number | null>(null)
  const sessionDeadRef = useRef(false)
  const connectRef = useRef<() => void>(() => {})

  // Store callbacks in refs to avoid recreating connect() on every render
  const onDataRef = useRef(onData)
  const onConnectRef = useRef(onConnect)
  const onDisconnectRef = useRef(onDisconnect)

  useEffect(() => {
    onDataRef.current = onData
    onConnectRef.current = onConnect
    onDisconnectRef.current = onDisconnect
  }, [onData, onConnect, onDisconnect])

  const connect = useCallback(() => {
    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    const wsUrl = `ws://${apiHost}/api/session/${encodeURIComponent(sessionName)}/stream`
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
        } else if (message.type === 'error') {
          setError(message.message)
        } else if (message.type === 'state_change') {
          // Update idle state from server
          setIdleState(message.state as SessionIdleState)
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
  }, [sessionName, apiHost])

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

    return () => {
      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        const ws = wsRef.current
        // Set to null first so handlers exit early
        wsRef.current = null
        ws.close()
      }
    }
  }, [connect])

  return { send, sendResize, isConnected, error, sessionDead, idleState }
}
