import { useState, useEffect, useCallback } from 'react'
import { Sun, Moon, Settings, Plus, Monitor, Info } from 'lucide-react'
import { getApiBase } from '../config'
import SessionCard from '../components/SessionCard'
import CreateSessionModal from '../components/CreateSessionModal'
import SettingsModal from '../components/SettingsModal'
import { useTheme } from '../hooks/useTheme'

interface Session {
  name: string
  workdir: string | null
  description: string | null
  displayName: string | null
  alive: boolean
  attached: boolean
  windows: number
  status?: string | null
  statusUpdatedAt?: string | null
  idleState?: 'unknown' | 'idle' | 'working' | 'error' | 'stalled' | null
  idleStateUpdatedAt?: string | null
  type?: 'direct' | 'worktree'
  worktreeParentRepo?: string | null
  worktreeBranch?: string | null
  lastUsedAt?: string | null
}

export default function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [lbSharedInstalled, setLbSharedInstalled] = useState<boolean | null>(null)
  const [installingLbShared, setInstallingLbShared] = useState(false)
  const [tmuxMouseEnabled, setTmuxMouseEnabled] = useState<boolean | null>(null)
  const [enablingTmuxMouse, setEnablingTmuxMouse] = useState(false)
  const { theme, setTheme } = useTheme()

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/sessions`)
      if (!res.ok) throw new Error('Failed to fetch sessions')
      const data = await res.json()
      setSessions(data.sessions || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions')
    } finally {
      setLoading(false)
    }
  }, [])

  const checkLbSharedStatus = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/shared/claude-md-status`)
      if (res.ok) {
        const data = await res.json()
        setLbSharedInstalled(data.installed)
      }
    } catch {
      // Silently fail - not critical
    }
  }, [])

  const checkTmuxMouse = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/tmux/mouse-status`)
      if (res.ok) {
        const data = await res.json()
        setTmuxMouseEnabled(data.enabled)
      }
    } catch {
      // Silently fail - not critical
    }
  }, [])

  const enableTmuxMouse = async (mode: 'full' | 'mouse_only') => {
    setEnablingTmuxMouse(true)
    try {
      const res = await fetch(`${getApiBase()}/tmux/enable-mouse`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode }),
      })
      if (res.ok) {
        setTmuxMouseEnabled(true)
      }
    } catch {
      // Ignore errors
    } finally {
      setEnablingTmuxMouse(false)
    }
  }

  const installLbShared = async () => {
    setInstallingLbShared(true)
    try {
      const res = await fetch(`${getApiBase()}/shared/setup-claude-md`, {
        method: 'POST',
      })
      if (res.ok) {
        setLbSharedInstalled(true)
      }
    } catch {
      // Ignore errors
    } finally {
      setInstallingLbShared(false)
    }
  }

  useEffect(() => {
    fetchSessions()
    checkLbSharedStatus()
    checkTmuxMouse()
    // Poll for session updates every 10 seconds
    const interval = setInterval(fetchSessions, 10000)
    return () => clearInterval(interval)
  }, [fetchSessions, checkLbSharedStatus, checkTmuxMouse])

  const handleDelete = async (name: string, cleanupWorktree?: boolean) => {
    try {
      const url = new URL(`${getApiBase()}/sessions/${name}`)
      if (cleanupWorktree) {
        url.searchParams.set('cleanup_worktree', 'true')
      }
      const res = await fetch(url.toString(), {
        method: 'DELETE',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to delete session')
      }
      // Refresh sessions list
      fetchSessions()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to delete session')
    }
  }

  const handleUpdate = async (
    name: string,
    updates: { displayName?: string; description?: string }
  ) => {
    try {
      const res = await fetch(`${getApiBase()}/sessions/${name}`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(updates),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to update session')
      }
      // Refresh sessions list
      fetchSessions()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to update session')
    }
  }

  const handleReset = async (name: string) => {
    try {
      const res = await fetch(`${getApiBase()}/sessions/${name}/reset`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to reset session')
      }
      // Refresh sessions list
      fetchSessions()
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reset session')
    }
  }

  // Separate alive and dead sessions, sort by last used (most recent first)
  const sortByLastUsed = (a: Session, b: Session) => {
    const aTime = a.lastUsedAt || ''
    const bTime = b.lastUsedAt || ''
    return bTime.localeCompare(aTime)
  }
  const aliveSessions = sessions.filter((s) => s.alive).sort(sortByLastUsed)
  const deadSessions = sessions.filter((s) => !s.alive).sort(sortByLastUsed)

  return (
    <div className="h-full flex flex-col bg-bg-sunken text-text-primary overflow-hidden">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-bg-surface border-b border-border-default">
        <h1 className="text-xl font-semibold text-text-secondary">Lumbergh</h1>
        <div className="flex items-center gap-2">
          {/* Theme toggle */}
          <button
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            title={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            className="p-2 text-text-tertiary hover:text-text-primary hover:bg-control-bg rounded transition-colors"
          >
            {theme === 'dark' ? <Sun size={20} /> : <Moon size={20} />}
          </button>
          <button
            onClick={() => setShowSettingsModal(true)}
            title="Settings"
            className="p-2 text-text-tertiary hover:text-text-primary hover:bg-control-bg rounded transition-colors"
          >
            <Settings size={20} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          >
            <Plus size={16} />
            New Session
          </button>
        </div>
      </header>

      {/* LB Shared setup banner */}
      {lbSharedInstalled === false && (
        <div className="mx-4 mt-4 p-3 bg-blue-900/50 border border-blue-700 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Info size={20} className="text-blue-400 flex-shrink-0" />
            <span className="text-sm text-text-secondary">
              Enable cross-session sharing by adding LB Shared commands to your CLAUDE.md
            </span>
          </div>
          <button
            onClick={installLbShared}
            disabled={installingLbShared}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 rounded transition-colors"
          >
            {installingLbShared ? 'Installing...' : 'Enable'}
          </button>
        </div>
      )}

      {/* Tmux mouse mode banner */}
      {tmuxMouseEnabled === false && (
        <div className="mx-4 mt-4 p-3 bg-yellow-900/50 border border-yellow-700 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Info size={20} className="text-yellow-400 flex-shrink-0" />
            <span className="text-sm text-text-secondary">
              Tmux mouse mode is off — terminal scrolling and clicking won't work in the browser
            </span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => enableTmuxMouse('mouse_only')}
              disabled={enablingTmuxMouse}
              className="px-3 py-1.5 text-sm bg-yellow-700 hover:bg-yellow-600 disabled:bg-yellow-800 rounded transition-colors"
            >
              Just enable mouse
            </button>
            <button
              onClick={() => enableTmuxMouse('full')}
              disabled={enablingTmuxMouse}
              className="px-3 py-1.5 text-sm bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-800 rounded transition-colors"
            >
              Install full config
            </button>
          </div>
        </div>
      )}

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-4">
        <div className="max-w-6xl mx-auto">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <span className="text-text-muted">Loading sessions...</span>
            </div>
          ) : error ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4">
              <span className="text-red-400">{error}</span>
              <button
                onClick={fetchSessions}
                className="px-4 py-2 bg-control-bg hover:bg-control-bg-hover rounded transition-colors"
              >
                Retry
              </button>
            </div>
          ) : sessions.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 gap-4 text-text-muted">
              <Monitor size={64} strokeWidth={1} />
              <p>No sessions yet</p>
              <p className="text-sm">
                Create a new session to get started, or existing tmux sessions will appear here
              </p>
            </div>
          ) : (
            <>
              {/* Active sessions */}
              {aliveSessions.length > 0 && (
                <section className="mb-8">
                  <h2 className="text-sm font-medium text-text-tertiary mb-3 uppercase tracking-wide">
                    Active Sessions
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {aliveSessions.map((session) => (
                      <SessionCard
                        key={session.name}
                        session={session}
                        onDelete={handleDelete}
                        onUpdate={handleUpdate}
                        onReset={handleReset}
                      />
                    ))}
                  </div>
                </section>
              )}

              {/* Dead sessions (stored but not running) */}
              {deadSessions.length > 0 && (
                <section>
                  <h2 className="text-sm font-medium text-text-muted mb-3 uppercase tracking-wide">
                    Inactive Sessions
                  </h2>
                  <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                    {deadSessions.map((session) => (
                      <SessionCard
                        key={session.name}
                        session={session}
                        onDelete={handleDelete}
                        onUpdate={handleUpdate}
                        onReset={handleReset}
                      />
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>

      {/* Create session modal */}
      {showCreateModal && (
        <CreateSessionModal onClose={() => setShowCreateModal(false)} onCreated={fetchSessions} />
      )}

      {/* Settings modal */}
      {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} />}
    </div>
  )
}
