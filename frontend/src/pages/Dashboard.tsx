import { useState, useEffect, useCallback } from 'react'
import SessionCard from '../components/SessionCard'
import CreateSessionModal from '../components/CreateSessionModal'

interface Session {
  name: string
  workdir: string | null
  description: string | null
  alive: boolean
  attached: boolean
  windows: number
}

export default function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)

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

  useEffect(() => {
    fetchSessions()
    // Poll for session updates every 10 seconds
    const interval = setInterval(fetchSessions, 10000)
    return () => clearInterval(interval)
  }, [fetchSessions])

  const handleDelete = async (name: string) => {
    try {
      const res = await fetch(`http://${apiHost}/api/sessions/${name}`, {
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

  // Separate alive and dead sessions
  const aliveSessions = sessions.filter(s => s.alive)
  const deadSessions = sessions.filter(s => !s.alive)

  return (
    <div className="min-h-screen bg-gray-900 text-white">
      {/* Header */}
      <header className="flex items-center justify-between p-4 bg-gray-800 border-b border-gray-700">
        <h1 className="text-xl font-semibold text-gray-200">Lumbergh</h1>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Session
        </button>
      </header>

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
            <svg className="w-16 h-16 text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1} d="M9.75 17L9 20l-1 1h8l-1-1-.75-3M3 13h18M5 17h14a2 2 0 002-2V5a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
            </svg>
            <p>No sessions yet</p>
            <p className="text-sm">Create a new session to get started, or existing tmux sessions will appear here</p>
          </div>
        ) : (
          <>
            {/* Active sessions */}
            {aliveSessions.length > 0 && (
              <section className="mb-8">
                <h2 className="text-sm font-medium text-gray-400 mb-3 uppercase tracking-wide">Active Sessions</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {aliveSessions.map(session => (
                    <SessionCard
                      key={session.name}
                      session={session}
                      onDelete={handleDelete}
                    />
                  ))}
                </div>
              </section>
            )}

            {/* Dead sessions (stored but not running) */}
            {deadSessions.length > 0 && (
              <section>
                <h2 className="text-sm font-medium text-gray-500 mb-3 uppercase tracking-wide">Inactive Sessions</h2>
                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                  {deadSessions.map(session => (
                    <SessionCard
                      key={session.name}
                      session={session}
                      onDelete={handleDelete}
                    />
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
    </div>
  )
}
