import { useCallback, useMemo } from 'react'

interface ApiClientOptions {
  apiHost: string
  sessionName?: string
}

interface RequestOptions {
  headers?: Record<string, string>
}

interface ApiError {
  detail?: string
  message?: string
}

/**
 * Hook providing consistent API client methods for backend communication.
 * Handles URL construction, JSON serialization, and response parsing.
 */
export function useApiClient({ apiHost, sessionName }: ApiClientOptions) {
  const baseUrl = useMemo(() => `http://${apiHost}/api`, [apiHost])

  const sessionUrl = useMemo(
    () => (sessionName ? `${baseUrl}/sessions/${sessionName}` : null),
    [baseUrl, sessionName]
  )

  /**
   * Build a URL for the given path.
   * If path starts with '/', it's relative to baseUrl.
   * Use 'session:' prefix for session-scoped endpoints.
   */
  const buildUrl = useCallback(
    (path: string): string => {
      if (path.startsWith('session:')) {
        if (!sessionUrl) throw new Error('Session name required for session-scoped endpoints')
        return `${sessionUrl}${path.slice(7)}`
      }
      return `${baseUrl}${path}`
    },
    [baseUrl, sessionUrl]
  )

  /**
   * Parse error response from API
   */
  const parseError = async (res: Response, defaultMessage: string): Promise<string> => {
    try {
      const data: ApiError = await res.json()
      return data.detail || data.message || defaultMessage
    } catch {
      return defaultMessage
    }
  }

  /**
   * Perform a GET request
   */
  const get = useCallback(
    async <T>(path: string, options?: RequestOptions): Promise<T> => {
      const url = buildUrl(path)
      const res = await fetch(url, {
        method: 'GET',
        headers: options?.headers,
      })
      if (!res.ok) {
        const message = await parseError(res, `GET ${path} failed`)
        throw new Error(message)
      }
      return res.json()
    },
    [buildUrl]
  )

  /**
   * Perform a POST request with JSON body
   */
  const post = useCallback(
    async <T>(path: string, body?: unknown, options?: RequestOptions): Promise<T> => {
      const url = buildUrl(path)
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      })
      if (!res.ok) {
        const message = await parseError(res, `POST ${path} failed`)
        throw new Error(message)
      }
      return res.json()
    },
    [buildUrl]
  )

  /**
   * Perform a PATCH request with JSON body
   */
  const patch = useCallback(
    async <T>(path: string, body: unknown, options?: RequestOptions): Promise<T> => {
      const url = buildUrl(path)
      const res = await fetch(url, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          ...options?.headers,
        },
        body: JSON.stringify(body),
      })
      if (!res.ok) {
        const message = await parseError(res, `PATCH ${path} failed`)
        throw new Error(message)
      }
      return res.json()
    },
    [buildUrl]
  )

  /**
   * Perform a DELETE request
   */
  const del = useCallback(
    async <T>(path: string, options?: RequestOptions): Promise<T> => {
      const url = buildUrl(path)
      const res = await fetch(url, {
        method: 'DELETE',
        headers: options?.headers,
      })
      if (!res.ok) {
        const message = await parseError(res, `DELETE ${path} failed`)
        throw new Error(message)
      }
      return res.json()
    },
    [buildUrl]
  )

  /**
   * Perform a POST request without throwing on error (for fire-and-forget operations)
   */
  const postSilent = useCallback(
    async (path: string, body?: unknown): Promise<boolean> => {
      try {
        const url = buildUrl(path)
        const res = await fetch(url, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: body !== undefined ? JSON.stringify(body) : undefined,
        })
        return res.ok
      } catch {
        return false
      }
    },
    [buildUrl]
  )

  return {
    baseUrl,
    sessionUrl,
    buildUrl,
    get,
    post,
    patch,
    delete: del,
    postSilent,
  }
}
