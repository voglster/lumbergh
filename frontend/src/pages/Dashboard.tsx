import { useState, useEffect, useCallback } from 'react'
import {
  Sun,
  Moon,
  Settings,
  Plus,
  Monitor,
  Info,
  ArrowUpCircle,
  X,
  BookOpen,
  Star,
  FolderOpen,
} from 'lucide-react'
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
  paused?: boolean
  agentProvider?: string | null
}

function DashboardBanners({
  lbSharedInstalled,
  installingLbShared,
  tmuxMouseEnabled,
  enablingTmuxMouse,
  isFirstRun,
  defaultRepoDir,
  updateInfo,
  onInstallLbShared,
  onEnableTmuxMouse,
  onOpenSettings,
  onDismissFirstRun,
  onDismissUpdate,
  getUpdateMessage,
}: {
  lbSharedInstalled: boolean | null
  installingLbShared: boolean
  tmuxMouseEnabled: boolean | null
  enablingTmuxMouse: boolean
  isFirstRun: boolean | null
  defaultRepoDir: string
  updateInfo: { current: string; latest: string } | null
  onInstallLbShared: () => void
  onEnableTmuxMouse: (mode: 'full' | 'mouse_only') => void
  onOpenSettings: () => void
  onDismissFirstRun: () => void
  onDismissUpdate: (version: string) => void
  getUpdateMessage: (current: string, latest: string) => string
}) {
  return (
    <>
      {lbSharedInstalled === false && (
        <div className="mx-4 mt-4 p-3 bg-blue-900/50 border border-blue-700 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Info size={20} className="text-blue-400 flex-shrink-0" />
            <span className="text-sm text-text-secondary">
              Enable cross-session sharing by adding LB Shared commands to your CLAUDE.md
            </span>
          </div>
          <button
            onClick={onInstallLbShared}
            disabled={installingLbShared}
            className="px-3 py-1.5 text-sm bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 rounded transition-colors"
          >
            {installingLbShared ? 'Installing...' : 'Enable'}
          </button>
        </div>
      )}

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
              onClick={() => onEnableTmuxMouse('mouse_only')}
              disabled={enablingTmuxMouse}
              className="px-3 py-1.5 text-sm bg-yellow-700 hover:bg-yellow-600 disabled:bg-yellow-800 rounded transition-colors"
            >
              Just enable mouse
            </button>
            <button
              onClick={() => onEnableTmuxMouse('full')}
              disabled={enablingTmuxMouse}
              className="px-3 py-1.5 text-sm bg-yellow-600 hover:bg-yellow-500 disabled:bg-yellow-800 rounded transition-colors"
            >
              Install full config
            </button>
          </div>
        </div>
      )}

      {isFirstRun && defaultRepoDir && (
        <div className="mx-4 mt-4 p-3 bg-blue-900/50 border border-blue-700 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <FolderOpen size={20} className="text-blue-400 flex-shrink-0" />
            <span className="text-sm text-text-secondary">
              Searching for repos in <span className="font-mono">{defaultRepoDir}</span> —{' '}
              <button
                onClick={onOpenSettings}
                className="text-blue-400 hover:text-blue-300 underline"
              >
                Change in Settings
              </button>
            </span>
          </div>
          <button
            onClick={onDismissFirstRun}
            title="Dismiss"
            className="p-1.5 text-text-tertiary hover:text-text-primary rounded transition-colors"
          >
            <X size={16} />
          </button>
        </div>
      )}

      {updateInfo && (
        <div className="mx-4 mt-4 p-3 bg-yellow-900/50 border border-yellow-700 rounded-lg flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ArrowUpCircle size={20} className="text-yellow-400 flex-shrink-0" />
            <span className="text-sm text-text-secondary">
              {getUpdateMessage(updateInfo.current, updateInfo.latest)}
              <code className="ml-2 text-xs bg-black/30 px-1.5 py-0.5 rounded font-mono">
                Run: uv tool upgrade pylumbergh
              </code>
            </span>
          </div>
          <div className="flex items-center gap-2">
            <a
              href={`https://github.com/voglster/lumbergh/releases/tag/v${updateInfo.latest}`}
              target="_blank"
              rel="noopener noreferrer"
              className="px-3 py-1.5 text-sm bg-yellow-600 hover:bg-yellow-500 rounded transition-colors"
            >
              View Release
            </a>
            <button
              onClick={() => onDismissUpdate(updateInfo.latest)}
              title="Dismiss"
              className="p-1.5 text-text-tertiary hover:text-text-primary rounded transition-colors"
            >
              <X size={16} />
            </button>
          </div>
        </div>
      )}
    </>
  )
}

export default function Dashboard() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [showCreateModal, setShowCreateModal] = useState(false)
  const [showSettingsModal, setShowSettingsModal] = useState(false)
  const [isFirstRun, setIsFirstRun] = useState<boolean | null>(null)
  const [defaultRepoDir, setDefaultRepoDir] = useState('')
  const [lbSharedInstalled, setLbSharedInstalled] = useState<boolean | null>(null)
  const [installingLbShared, setInstallingLbShared] = useState(false)
  const [tmuxMouseEnabled, setTmuxMouseEnabled] = useState<boolean | null>(null)
  const [enablingTmuxMouse, setEnablingTmuxMouse] = useState(false)
  const [updateInfo, setUpdateInfo] = useState<{
    current: string
    latest: string
  } | null>(null)
  const { theme, setTheme } = useTheme()

  const UPDATE_MESSAGES = [
    (_c: string, l: string) => `Yeah, if you could go ahead and update to v${l}, that'd be great.`,
    (_c: string, l: string) => `I'm gonna need you to go ahead and update to v${l}. Mmkay?`,
    (c: string, l: string) =>
      `What would you say... you DO here? Besides run v${c} when v${l} exists?`,
    (_c: string, l: string) =>
      `We're putting cover sheets on all TPS reports now. Also, v${l} is out.`,
    (c: string, l: string) => `Have you seen my stapler? Also, v${l} is out. You're on v${c}.`,
    (c: string, l: string) =>
      `PC Load Letter?! No wait — v${l} is available. Please update from v${c}.`,
  ]

  function getUpdateMessage(current: string, latest: string): string {
    const idx = Math.floor(Math.random() * UPDATE_MESSAGES.length)
    return UPDATE_MESSAGES[idx](current, latest)
  }

  function isDismissed(version: string): boolean {
    return localStorage.getItem('lumbergh:dismissedVersion') === version
  }

  function dismissUpdate(version: string) {
    localStorage.setItem('lumbergh:dismissedVersion', version)
    setUpdateInfo(null)
  }

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

  const checkFirstRun = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/settings`)
      if (res.ok) {
        const data = await res.json()
        setIsFirstRun(data.isFirstRun ?? false)
        setDefaultRepoDir(data.repoSearchDir ?? '')
      }
    } catch {
      // Silently fail - not critical
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

  const checkVersion = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/version`)
      if (res.ok) {
        const data = await res.json()
        if (data.update_available && data.latest && !isDismissed(data.latest)) {
          setUpdateInfo({ current: data.current, latest: data.latest })
        }
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
    checkFirstRun()
    checkLbSharedStatus()
    checkTmuxMouse()
    checkVersion()
    // Poll for session updates every 10 seconds
    const interval = setInterval(fetchSessions, 10000)
    return () => clearInterval(interval)
  }, [fetchSessions, checkFirstRun, checkLbSharedStatus, checkTmuxMouse, checkVersion])

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
    updates: { displayName?: string; description?: string; paused?: boolean }
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
          {/* GitHub docs */}
          <a
            href="https://voglster.github.io/lumbergh/"
            target="_blank"
            rel="noopener noreferrer"
            title="Documentation"
            className="p-2 text-text-tertiary hover:text-text-primary hover:bg-control-bg rounded transition-colors"
          >
            <BookOpen size={20} />
          </a>
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
            data-testid="settings-btn"
            className="p-2 text-text-tertiary hover:text-text-primary hover:bg-control-bg rounded transition-colors"
          >
            <Settings size={20} />
          </button>
          <button
            onClick={() => setShowCreateModal(true)}
            data-testid="new-session-btn"
            className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded transition-colors"
          >
            <Plus size={16} />
            New Session
          </button>
        </div>
      </header>

      <DashboardBanners
        lbSharedInstalled={lbSharedInstalled}
        installingLbShared={installingLbShared}
        tmuxMouseEnabled={tmuxMouseEnabled}
        enablingTmuxMouse={enablingTmuxMouse}
        isFirstRun={isFirstRun}
        defaultRepoDir={defaultRepoDir}
        updateInfo={updateInfo}
        onInstallLbShared={installLbShared}
        onEnableTmuxMouse={enableTmuxMouse}
        onOpenSettings={() => setShowSettingsModal(true)}
        onDismissFirstRun={() => setIsFirstRun(false)}
        onDismissUpdate={dismissUpdate}
        getUpdateMessage={getUpdateMessage}
      />

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
              <button
                onClick={() => setShowCreateModal(true)}
                className="mt-2 flex items-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-500 text-white rounded-lg font-medium transition-colors text-base"
              >
                <Plus size={20} />
                Create Your First Session
              </button>
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
                      <div key={session.name} data-testid={`session-card-${session.name}`}>
                        <SessionCard
                          session={session}
                          onDelete={handleDelete}
                          onUpdate={handleUpdate}
                          onReset={handleReset}
                        />
                      </div>
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
                      <div key={session.name} data-testid={`session-card-${session.name}`}>
                        <SessionCard
                          session={session}
                          onDelete={handleDelete}
                          onUpdate={handleUpdate}
                          onReset={handleReset}
                        />
                      </div>
                    ))}
                  </div>
                </section>
              )}
            </>
          )}
        </div>
      </main>

      {/* Footer */}
      <footer className="py-4 text-center">
        <a
          href="https://github.com/voglster/lumbergh"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 text-xs text-text-muted hover:text-amber-400 transition-colors group"
        >
          I was told there would be
          <Star size={14} className="group-hover:fill-amber-400 transition-colors" />
          stars
        </a>
      </footer>

      {/* Create session modal */}
      {showCreateModal && (
        <CreateSessionModal onClose={() => setShowCreateModal(false)} onCreated={fetchSessions} />
      )}

      {/* Settings modal */}
      {showSettingsModal && <SettingsModal onClose={() => setShowSettingsModal(false)} />}
    </div>
  )
}
