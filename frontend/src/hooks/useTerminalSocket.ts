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
  isConnected: boolean
  error: string | null
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
  const reconnectTimeoutRef = useRef<number | null>(null)
  // Track if component is still mounted (handles React StrictMode)
  const mountedRef = useRef(true)

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
    // Skip connection if component has unmounted (StrictMode cleanup)
    if (!mountedRef.current) {
      return
    }

    if (wsRef.current?.readyState === WebSocket.OPEN) {
      return
    }

    const wsUrl = `ws://${apiHost}/api/session/${encodeURIComponent(sessionName)}/stream`
    const ws = new WebSocket(wsUrl)

    ws.onopen = () => {
      // Don't update state if unmounted
      if (!mountedRef.current) {
        ws.close()
        return
      }
      setIsConnected(true)
      setError(null)
      onConnectRef.current?.()
    }

    ws.onmessage = (event) => {
      if (!mountedRef.current) return
      try {
        const message = JSON.parse(event.data)
        if (message.type === 'output') {
          onDataRef.current(message.data)
        } else if (message.type === 'error') {
          setError(message.message)
        }
      } catch {
        // If not JSON, treat as raw output
        onDataRef.current(event.data)
      }
    }

    ws.onclose = () => {
      if (!mountedRef.current) return
      setIsConnected(false)
      onDisconnectRef.current?.()
      wsRef.current = null

      // Only attempt reconnect if still mounted
      if (mountedRef.current) {
        reconnectTimeoutRef.current = window.setTimeout(() => {
          connect()
        }, 2000)
      }
    }

    ws.onerror = () => {
      if (!mountedRef.current) return
      setError('WebSocket connection error')
    }

    wsRef.current = ws
  }, [sessionName, apiHost])

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
    mountedRef.current = true
    connect()

    return () => {
      // Mark as unmounted first to prevent reconnection attempts
      mountedRef.current = false

      if (reconnectTimeoutRef.current) {
        clearTimeout(reconnectTimeoutRef.current)
        reconnectTimeoutRef.current = null
      }
      if (wsRef.current) {
        wsRef.current.close()
        wsRef.current = null
      }
    }
  }, [connect])

  return { send, sendResize, isConnected, error }
}
