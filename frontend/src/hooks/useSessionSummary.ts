import { useState, useEffect, useCallback, useRef } from 'react'
import { getApiBase } from '../config'

interface SessionSummary {
  summary: string
  generated_at: string
  stale: boolean
  available: boolean
  provider: string
  model: string
}

const POLL_INTERVAL = 60_000 // 60 seconds
const DISMISS_KEY = 'lumbergh:summaryDismissed'

export function useSessionSummary(sessionName: string | undefined) {
  const [data, setData] = useState<SessionSummary | null>(null)
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const mountedRef = useRef(true)

  const fetchSummary = useCallback(
    async (force = false) => {
      if (!sessionName) return
      if (force) setIsLoading(true)
      try {
        const url = `${getApiBase()}/sessions/${sessionName}/summary${force ? '?force=true' : ''}`
        const res = await fetch(url)
        if (!res.ok) {
          setError('Failed to fetch summary')
          return
        }
        const result: SessionSummary = await res.json()
        if (mountedRef.current) {
          setData(result)
          setError(null)
        }
      } catch {
        if (mountedRef.current) {
          setError('Failed to fetch summary')
        }
      } finally {
        if (mountedRef.current) {
          setIsLoading(false)
        }
      }
    },
    [sessionName]
  )

  useEffect(() => {
    mountedRef.current = true
    setIsLoading(true)
    fetchSummary()

    const interval = setInterval(() => fetchSummary(), POLL_INTERVAL)
    return () => {
      mountedRef.current = false
      clearInterval(interval)
    }
  }, [fetchSummary])

  const regenerate = useCallback(() => fetchSummary(true), [fetchSummary])

  return {
    summary: data?.summary || '',
    generatedAt: data?.generated_at || '',
    stale: data?.stale || false,
    available: data?.available ?? true,
    provider: data?.provider || '',
    model: data?.model || '',
    isLoading,
    error,
    refetch: () => fetchSummary(),
    regenerate,
  }
}

/** Check if summary is permanently dismissed for all sessions. */
export function isSummaryDismissed(): boolean {
  return localStorage.getItem(DISMISS_KEY) === 'true'
}

/** Permanently dismiss summaries. */
export function dismissSummary(): void {
  localStorage.setItem(DISMISS_KEY, 'true')
}

/** Re-enable summaries. */
export function enableSummary(): void {
  localStorage.removeItem(DISMISS_KEY)
}
