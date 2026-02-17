import { useState, useEffect, useCallback } from 'react'
import SessionCard from '../components/SessionCard'
import CreateSessionModal from '../components/CreateSessionModal'
import SettingsModal from '../components/SettingsModal'

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
}

export default function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [lbSharedInstalled, setLbSharedInstalled] = useState<boolean | null>(null)
  const [installingLbShared, setInstallingLbShared] = useState(false)

  // Determine API host - use same hostname but port 8000 for backend
  const apiHost = `${window.location.hostname}:8000`

  const fetchSessions = useCallback(async () => {
    try {
      const res = await fetch(`http://${apiHost}/api/sessions`)
      if (!res.ok) throw new Error('Failed to fetch sessions')
      const data = await res.json()
      setSessions(data.sessions || [])
      setError(null)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch sessions')
    } finally {
      setLoading(false)
    }
  }, [apiHost])

  const checkLbSharedStatus = useCallback(async () => {
    try {
      const res = await fetch(`http://${apiHost}/api/shared/claude-md-status`)
      if (res.ok) {
        const data = await res.json()
        setLbSharedInstalled(data.installed)
      }
    } catch {
      // Silently fail - not critical
    }
  }, [apiHost])

  const installLbShared = async () => {
    setInstallingLbShared(true)
    try {
      const res = await fetch(`http://${apiHost}/api/shared/setup-claude-md`, {
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
    // Poll for session updates every 10 seconds
    const interval = setInterval(fetchSessions, 10000)
    return () => clearInterval(interval)
  }, [fetchSessions, checkLbSharedStatus])

  const handleDelete = async (name: string, cleanupWorktree?: boolean) => {
    try {
      const url = new URL(`http://${apiHost}/api/sessions/${name}`)
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

  const handleUpdate = async (name: string, updates: { displayName?: string; description?: string }) => {
    try {
      const res = await fetch(`http://${apiHost}/api/sessions/${name}`, {
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

  // Separate alive and dead sessions
  const aliveSessions = sessions.filter((s) => s.alive)
  const deadSessions = sessions.filter((s) => !s.alive)

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
        <h1 className="text-xl font-semibold text-gray-200">Lumbergh</h1>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setShowSettingsModal(true)}
            title="Settings"
            className="p-2 text-gray-400 hover:text-white hover:bg-gray-700 rounded transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 4v16m8-8H4"
              />
            </svg>
            New Session
          </button>
        </div>
      </header>

      {/* LB Shared setup banner */}
      {lbSharedInstalled === false && (
        <div className="mx-4 mt-4 p-3 bg-blue-900/50 border border-blue-700 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <svg className="w-5 h-5 text-blue-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <span className="text-sm text-gray-300">
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

      {/* Main content */}
      <main className="p-4 max-w-6xl mx-auto">
        {loading ? (
          <div className="flex items-center justify-center py-12">
            <span className="text-gray-500">Loading sessions...</span>
          </div>
        ) : error ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4">
            <span className="text-red-400">{error}</span>
            <button
              onClick={fetchSessions}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded transition-colors"
            >
              Retry
            </button>
          </div>
        ) : sessions.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-12 gap-4 text-gray-500">
            <svg
              className="w-16 h-16 text-gray-600"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={1}
                d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z"
              />
            </svg>
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
                <h2 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wide">
                  Active Sessions
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {aliveSessions.map((session) => (
                    <SessionCard key={session.name} session={session} onDelete={handleDelete} onUpdate={handleUpdate} />
                  ))}
                </div>
              </section>
            )}

            {/* Dead sessions (stored but not running) */}
            {deadSessions.length > 0 && (
              <section>
                <h2 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wide">
                  Inactive Sessions
                </h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {deadSessions.map((session) => (
                    <SessionCard key={session.name} session={session} onDelete={handleDelete} onUpdate={handleUpdate} />
                  ))}
                </div>
              </section>
            )}
          </>
        )}
      </main>

      {/* Create session modal */}
      {showCreateModal && (
        <CreateSessionModal
          apiHost={apiHost}
          onClose={() => setShowCreateModal(false)}
          onCreated={fetchSessions}
        />
      )}

      {/* Settings modal */}
      {showSettingsModal && (
        <SettingsModal apiHost={apiHost} onClose={() => setShowSettingsModal(false)} />
      )}
    </div>
  )
}
