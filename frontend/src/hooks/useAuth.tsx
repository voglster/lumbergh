import { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react'

interface AuthContextValue {
  loading: boolean
  authenticated: boolean
  login: (password: string) => Promise<string | null>
  logout: () => Promise<void>
}

const AuthContext = createContext<AuthContextValue | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const [loading, setLoading] = useState(true)
  const [authenticated, setAuthenticated] = useState(false)

  useEffect(() => {
    fetch('/api/auth/status')
      .then((r) => r.json())
      .then((data) => {
        setAuthenticated(!data.enabled || data.authenticated)
      })
      .catch(() => {
        // If status check fails, assume no auth needed (backwards compat)
        setAuthenticated(true)
      })
      .finally(() => setLoading(false))
  }, [])

  const login = useCallback(async (password: string): Promise<string | null> => {
    const res = await fetch('/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ password }),
    })
    if (res.ok) {
      setAuthenticated(true)
      return null
    }
    const data = await res.json()
    return data.detail || 'Login failed'
  }, [])

  const logout = useCallback(async () => {
    await fetch('/api/auth/logout', { method: 'POST' })
    setAuthenticated(false)
  }, [])

  return (
    <AuthContext.Provider value={{ loading, authenticated, login, logout }}>
      {children}
    </AuthContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components -- co-locating provider and hook is standard React pattern
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth must be used within AuthProvider')
  return ctx
}
