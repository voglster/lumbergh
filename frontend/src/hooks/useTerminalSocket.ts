import { useRef, useCallback, useEffect, useState } from 'react'

interface UseTerminalSocketOptions {
  sessionName: string
  apiHost: string
  onData: (data: string) => void
  onConnect?: () => void
  onDisconnect?: () => void
}

interface UseTerminalSocketResult {
  send: (data: string) => void
  sendResize: (cols: number, rows: number) => void
  reconnect: () => void
  isConnected: boolean
  error: string | null
  reconnecting: boolean
  sessionDead: boolean
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
  const [reconnecting, setReconnecting] = useState(false)
  const [sessionDead, setSessionDead] = useState(false)
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
      setReconnecting(false)
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
        setReconnecting(true)
        setError(null) // Clear error while reconnecting
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connectRef.current()
        }, 2000)
      }
    }

    ws.onerror = () => {
      // Only process if this is still the active WebSocket
      if (wsRef.current !== ws) return
      // Don't show error if we're going to reconnect — onclose will handle it
      if (sessionDeadRef.current) {
        setError('WebSocket connection error')
      }
    }

    wsRef.current = ws
  }, [sessionName, apiHost])

  // Keep connectRef updated
  useEffect(() => {
    connectRef.current = connect
  }, [connect])

  // Force an immediate reconnect (e.g., after screen unlock)
  const reconnect = useCallback(() => {
    if (sessionDeadRef.current) return
    if (wsRef.current?.readyState === WebSocket.OPEN) return

    // Cancel any pending delayed reconnect
    if (reconnectTimeoutRef.current) {
      clearTimeout(reconnectTimeoutRef.current)
      reconnectTimeoutRef.current = null
    }

    // Close any socket stuck in CONNECTING state
    if (wsRef.current) {
      const old = wsRef.current
      wsRef.current = null
      old.close()
    }

    connectRef.current()
  }, [])

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

  // Reconnect immediately when page becomes visible (e.g., screen unlock, tab switch back)
  // Browsers throttle timers in hidden tabs, so the 2s reconnect may not have fired yet
  useEffect(() => {
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        reconnect()
      }
    }
    document.addEventListener('visibilitychange', handleVisibility)
    return () => document.removeEventListener('visibilitychange', handleVisibility)
  }, [reconnect])

  return { send, sendResize, reconnect, isConnected, error, reconnecting, sessionDead }
}
