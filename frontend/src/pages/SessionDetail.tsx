import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft, Settings } from 'lucide-react'
import { getApiBase } from '../config'
import Terminal from '../components/Terminal'
import FileBrowser from '../components/FileBrowser'
import ResizablePanes from '../components/ResizablePanes'
import VerticalResizablePanes from '../components/VerticalResizablePanes'
import TodoList from '../components/TodoList'
import Scratchpad from '../components/Scratchpad'
import PromptTemplates from '../components/PromptTemplates'
import SharedFiles from '../components/SharedFiles'
import TelemetryOptIn from '../components/TelemetryOptIn'
import GitTab from '../components/graph/GitTab'
import { useIsDesktop } from '../hooks/useMediaQuery'

type RightPanel = 'git' | 'files' | 'todos' | 'prompts' | 'shared'
type MobileTab = 'terminal' | 'git' | 'files' | 'todos' | 'prompts' | 'shared'

type DiffData = {
  files: Array<{ path: string; diff: string }>
  stats: { additions: number; deletions: number }
}

type TabVisibility = Record<string, boolean>

const ALL_TABS: { id: RightPanel; label: string }[] = [
  { id: 'git', label: 'Git' },
  { id: 'files', label: 'Files' },
  { id: 'todos', label: 'Todo' },
  { id: 'prompts', label: 'Prompts' },
  { id: 'shared', label: 'Shared' },
]

const DEFAULT_TAB_VISIBILITY: TabVisibility = {
  git: true,
  files: true,
  todos: true,
  prompts: true,
  shared: true,
}

// Compare diff data to avoid unnecessary re-renders
function diffDataEquals(a: DiffData | null, b: DiffData | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.stats.additions !== b.stats.additions || a.stats.deletions !== b.stats.deletions) {
    return false
  }
  if (a.files.length !== b.files.length) return false
  for (let i = 0; i < a.files.length; i++) {
    if (a.files[i].path !== b.files[i].path || a.files[i].diff !== b.files[i].diff) {
      return false
    }
  }
  return true
}

export default function SessionDetail() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()

  const [notFound, setNotFound] = useState(false)
  const [countdown, setCountdown] = useState(5)

  const [rightPanel, setRightPanel] = useState<RightPanel>(() => {
    const saved = localStorage.getItem('lumbergh:rightPanel')
    if (
      saved === 'git' ||
      saved === 'files' ||
      saved === 'todos' ||
      saved === 'prompts' ||
      saved === 'shared'
    ) {
      return saved
    }
    // Migrate old 'diff' or 'graph' to 'git'
    if (saved === 'diff' || saved === 'graph') return 'git'
    return 'git'
  })
  const [sharedRefreshTrigger, setSharedRefreshTrigger] = useState(0)
  const [gitTabResetTrigger, setGitTabResetTrigger] = useState(0)
  const [mobileTab, setMobileTab] = useState<MobileTab>('terminal')
  const [diffData, setDiffData] = useState<DiffData | null>(null)
  const [showTelemetryOptIn, setShowTelemetryOptIn] = useState(false)
  const [globalTabVisibility, setGlobalTabVisibility] =
    useState<TabVisibility>(DEFAULT_TAB_VISIBILITY)
  const [sessionTabVisibility, setSessionTabVisibility] = useState<TabVisibility | null>(null)
  const [showTabSettings, setShowTabSettings] = useState(false)
  const tabSettingsRef = useRef<HTMLDivElement>(null)
  const focusFnRef = useRef<(() => void) | null>(null)

  // Touch session to track last used time + check existence
  useEffect(() => {
    if (name) {
      fetch(`${getApiBase()}/sessions/${name}/touch`, { method: 'POST' })
        .then((res) => {
          if (res.status === 404) setNotFound(true)
        })
        .catch(() => {})
    }
  }, [name])

  // Fetch settings (telemetry consent + tab visibility)
  useEffect(() => {
    fetch(`${getApiBase()}/settings`)
      .then((res) => res.json())
      .then((data) => {
        if (data.telemetryConsent == null) setShowTelemetryOptIn(true)
        if (data.tabVisibility) setGlobalTabVisibility(data.tabVisibility)
      })
      .catch(() => {})
  }, [])

  // Fetch session metadata for per-session tab visibility
  useEffect(() => {
    if (!name) return
    fetch(`${getApiBase()}/sessions`)
      .then((res) => res.json())
      .then((data) => {
        const session = (data.sessions || []).find((s: { name: string }) => s.name === name)
        if (session?.tabVisibility) {
          setSessionTabVisibility(session.tabVisibility)
        }
      })
      .catch(() => {})
  }, [name])

  // Auto-redirect countdown when session not found
  useEffect(() => {
    if (!notFound) return
    if (countdown <= 0) {
      navigate('/')
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [notFound, countdown, navigate])

  // Persist right panel selection
  useEffect(() => {
    localStorage.setItem('lumbergh:rightPanel', rightPanel)
  }, [rightPanel])

  // Compute effective tab visibility (session overrides global)
  const effectiveTabVisibility = useMemo<TabVisibility>(
    () =>
      sessionTabVisibility
        ? { ...globalTabVisibility, ...sessionTabVisibility }
        : globalTabVisibility,
    [globalTabVisibility, sessionTabVisibility]
  )

  const visibleTabs = useMemo(
    () => ALL_TABS.filter((t) => effectiveTabVisibility[t.id] !== false),
    [effectiveTabVisibility]
  )

  const visibleMobileTabs = useMemo(
    () =>
      [{ id: 'terminal' as MobileTab, label: 'Terminal' }].concat(
        ALL_TABS.filter((t) => effectiveTabVisibility[t.id] !== false)
      ),
    [effectiveTabVisibility]
  )

  const isTerminalOnly = visibleTabs.length === 0

  // Auto-select first visible tab if current is hidden
  useEffect(() => {
    if (visibleTabs.length > 0 && effectiveTabVisibility[rightPanel] === false) {
      setRightPanel(visibleTabs[0].id)
    }
  }, [effectiveTabVisibility, rightPanel, visibleTabs])

  useEffect(() => {
    if (mobileTab !== 'terminal' && effectiveTabVisibility[mobileTab] === false) {
      setMobileTab('terminal')
    }
  }, [effectiveTabVisibility, mobileTab])

  // Close tab settings popover on outside click
  useEffect(() => {
    if (!showTabSettings) return
    const handleClick = (e: MouseEvent) => {
      if (tabSettingsRef.current && !tabSettingsRef.current.contains(e.target as Node)) {
        setShowTabSettings(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showTabSettings])

  // Save per-session tab visibility
  const saveSessionTabVisibility = useCallback(
    async (tv: TabVisibility) => {
      if (!name) return
      setSessionTabVisibility(tv)
      try {
        await fetch(`${getApiBase()}/sessions/${name}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tabVisibility: tv }),
        })
      } catch (err) {
        console.error('Failed to save tab visibility:', err)
      }
    },
    [name]
  )

  const handleFocusReady = useCallback((fn: () => void) => {
    focusFnRef.current = fn
  }, [])

  const handleFocusTerminal = useCallback(() => {
    focusFnRef.current?.()
  }, [])

  const handleSwitchToTerminal = useCallback(() => {
    setMobileTab('terminal')
    focusFnRef.current?.()
  }, [])

  const handleJumpToTodos = useCallback(() => {
    if (effectiveTabVisibility['todos'] === false) return
    setRightPanel('todos')
    setMobileTab('todos')
  }, [effectiveTabVisibility])

  const handleTodoSent = useCallback(
    async (text: string) => {
      if (!name) return
      try {
        await fetch(`${getApiBase()}/sessions/${name}/status-summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
      } catch (err) {
        console.error('Failed to update status summary:', err)
      }
    },
    [name]
  )

  const handleCycleSession = useCallback(
    async (direction: 'next' | 'prev') => {
      try {
        const res = await fetch(`${getApiBase()}/sessions`)
        if (!res.ok) return
        const data = await res.json()
        const active = (data.sessions || [])
          .filter((s: { alive: boolean; paused?: boolean }) => s.alive && !s.paused)
          .map((s: { name: string }) => s.name)
          .sort()
        if (active.length <= 1) return
        const currentIdx = active.indexOf(name)
        const step = direction === 'next' ? 1 : active.length - 1
        const nextIdx = (currentIdx + step) % active.length
        navigate(`/session/${active[nextIdx]}`)
      } catch {
        // Ignore errors
      }
    },
    [name, navigate]
  )

  const handleBack = useCallback(() => {
    navigate('/')
  }, [navigate])

  const handleReset = useCallback(async () => {
    if (!name) return
    try {
      const res = await fetch(`${getApiBase()}/sessions/${name}/reset`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to reset session')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reset session')
    }
  }, [name])

  const diffEtagRef = useRef<string>('')

  const fetchDiffData = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!name) return
      try {
        const headers: Record<string, string> = {}
        if (!force && diffEtagRef.current) headers['If-None-Match'] = diffEtagRef.current
        if (force) {
          // Invalidate backend cache so we get a fresh computation
          await fetch(`${getApiBase()}/sessions/${name}/git/invalidate`, { method: 'POST' }).catch(
            () => {}
          )
        }
        const res = await fetch(`${getApiBase()}/sessions/${name}/git/diff`, { headers })
        if (res.status === 304) return
        const data = await res.json()
        diffEtagRef.current = res.headers.get('etag') || ''
        // Only update state if data actually changed to prevent scroll resets
        setDiffData((prev) => (diffDataEquals(prev, data) ? prev : data))
      } catch (err) {
        console.error('Failed to fetch diff data:', err)
      }
    },
    [name]
  )

  // Lightweight stats for tab badges (polled always)
  const [diffStats, setDiffStats] = useState<{
    files: number
    additions: number
    deletions: number
  } | null>(null)

  // Is the git tab currently visible? (need to poll full diff data when visible)
  const isDiffVisible = isDesktop ? rightPanel === 'git' : mobileTab === 'git'

  // Poll lightweight diff-stats every 10s (for badge counts)
  const statsEtagRef = useRef<string>('')
  useEffect(() => {
    if (!name) return
    const fetchStats = async () => {
      try {
        const headers: Record<string, string> = {}
        if (statsEtagRef.current) headers['If-None-Match'] = statsEtagRef.current
        const res = await fetch(`${getApiBase()}/sessions/${name}/git/diff-stats`, {
          headers,
        })
        if (res.status === 304) return
        statsEtagRef.current = res.headers.get('etag') || ''
        const data = await res.json()
        setDiffStats((prev) => {
          if (
            prev &&
            prev.files === data.files &&
            prev.additions === data.additions &&
            prev.deletions === data.deletions
          ) {
            return prev
          }
          return data
        })
      } catch {
        // ignore
      }
    }
    fetchStats()
    const interval = setInterval(fetchStats, 10000)
    return () => clearInterval(interval)
  }, [name])

  // Full diff: fetch when diff tab becomes visible + poll while visible
  useEffect(() => {
    if (!isDiffVisible) return
    fetchDiffData()
    const interval = setInterval(fetchDiffData, 5000)
    return () => clearInterval(interval)
  }, [isDiffVisible, fetchDiffData])

  // Global paste handler for image uploads
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) continue

          const formData = new FormData()
          formData.append('file', file)

          try {
            const res = await fetch(`${getApiBase()}/shared/upload`, {
              method: 'POST',
              body: formData,
            })
            if (res.ok) {
              // Trigger refresh and switch to shared tab
              setSharedRefreshTrigger((n) => n + 1)
              setRightPanel('shared')
              setMobileTab('shared')
            }
          } catch (err) {
            console.error('Failed to upload image:', err)
          }
          break
        }
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // mobileTabs is now computed as visibleMobileTabs above

  const renderTerminal = () => (
    <div className="h-full" data-testid="terminal-container">
      {name ? (
        <Terminal
          sessionName={name}
          onFocusReady={handleFocusReady}
          onBack={isDesktop ? handleBack : undefined}
          onReset={handleReset}
          onCycleSession={handleCycleSession}
          isVisible={isDesktop || mobileTab === 'terminal'}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-text-muted">
          No session selected
        </div>
      )}
    </div>
  )

  const renderRightPanel = () => (
    <div className="h-full flex flex-col">
      {/* Panel switcher */}
      <div className="flex gap-1 p-2 bg-bg-surface border-b border-border-default">
        {visibleTabs.map((tab) => (
          <button
            key={tab.id}
            data-testid={`tab-${tab.id === 'todos' ? 'todo' : tab.id}`}
            onClick={() => {
              setRightPanel(tab.id)
              if (tab.id === 'git') setGitTabResetTrigger((n) => n + 1)
            }}
            className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
              rightPanel === tab.id
                ? 'bg-control-bg-hover text-text-primary'
                : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
            }`}
          >
            {tab.label}
            {tab.id === 'git' && diffStats && diffStats.files > 0 && (
              <span className="ml-2 text-xs">
                ({diffStats.files})
                <span className="text-green-400 ml-1">+{diffStats.additions}</span>
                <span className="text-red-400 ml-1">-{diffStats.deletions}</span>
              </span>
            )}
          </button>
        ))}
        {/* Gear icon for tab visibility settings */}
        <div className="relative ml-auto" ref={tabSettingsRef}>
          <button
            onClick={() => setShowTabSettings((v) => !v)}
            className="px-2 py-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-control-bg-hover transition-colors"
            title="Configure visible tabs"
          >
            <Settings size={14} />
          </button>
          {showTabSettings && (
            <div className="absolute right-0 top-full mt-1 bg-bg-surface border border-border-default rounded-lg shadow-lg p-3 z-50 min-w-[160px]">
              <p className="text-xs text-text-tertiary mb-2 font-medium">Visible Tabs</p>
              <label className="flex items-center gap-2 py-1 text-sm border-b border-border-default mb-1 pb-2">
                <input
                  type="checkbox"
                  checked={isTerminalOnly}
                  onChange={() => {
                    const currentVis = sessionTabVisibility || globalTabVisibility
                    if (isTerminalOnly) {
                      // Restore: use global defaults
                      saveSessionTabVisibility({ ...globalTabVisibility })
                    } else {
                      // Set all to false
                      const allOff = Object.fromEntries(
                        Object.keys(currentVis).map((k) => [k, false])
                      )
                      saveSessionTabVisibility(allOff)
                    }
                  }}
                  className="rounded border-input-border bg-input-bg"
                />
                <span className="text-text-secondary font-medium">Terminal Only</span>
              </label>
              {ALL_TABS.map((tab) => {
                const currentVis = sessionTabVisibility || globalTabVisibility
                const isEnabled = currentVis[tab.id] !== false
                return (
                  <label key={tab.id} className="flex items-center gap-2 py-1 text-sm">
                    <input
                      type="checkbox"
                      checked={isEnabled}
                      onChange={() => {
                        const updated = { ...currentVis, [tab.id]: !isEnabled }
                        saveSessionTabVisibility(updated)
                      }}
                      className="rounded border-input-border bg-input-bg"
                    />
                    <span className="text-text-secondary">{tab.label}</span>
                  </label>
                )
              })}
            </div>
          )}
        </div>
      </div>
      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {rightPanel === 'git' && (
          <GitTab
            key={name}
            sessionName={name}
            diffData={diffData}
            onRefreshDiff={() => fetchDiffData({ force: true })}
            onJumpToTodos={handleJumpToTodos}
            onFocusTerminal={handleFocusTerminal}
            resetTrigger={gitTabResetTrigger}
          />
        )}
        {rightPanel === 'files' && (
          <FileBrowser sessionName={name} onFocusTerminal={handleFocusTerminal} />
        )}
        {rightPanel === 'todos' && name && (
          <VerticalResizablePanes
            top={
              <TodoList
                sessionName={name}
                onFocusTerminal={handleFocusTerminal}
                onTodoSent={handleTodoSent}
                onSwitchToTerminal={handleSwitchToTerminal}
              />
            }
            bottom={<Scratchpad sessionName={name} onFocusTerminal={handleFocusTerminal} />}
            defaultTopHeight={50}
            minTopHeight={20}
            maxTopHeight={80}
            storageKey="lumbergh:todoSplitHeight"
          />
        )}
        {rightPanel === 'prompts' && (
          <PromptTemplates sessionName={name} onFocusTerminal={handleFocusTerminal} />
        )}
        {rightPanel === 'shared' && (
          <SharedFiles
            sessionName={name}
            onFocusTerminal={handleFocusTerminal}
            refreshTrigger={sharedRefreshTrigger}
          />
        )}
      </div>
    </div>
  )

  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-bg-sunken text-text-primary gap-4">
        <div className="text-red-400 text-xl font-semibold">Session Not Found</div>
        <p className="text-text-tertiary text-sm text-center px-4">
          The session <span className="text-text-secondary font-mono">"{name}"</span> does not exist
          or has been deleted.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-sm transition-colors"
        >
          Go to Dashboard
        </button>
        <p className="text-text-tertiary text-xs">Redirecting in {countdown}s...</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-bg-sunken text-text-primary">
      {showTelemetryOptIn && <TelemetryOptIn onClose={() => setShowTelemetryOptIn(false)} />}

      {/* Conditionally render only desktop OR mobile layout (not both) */}
      {isDesktop ? (
        <main className="flex-1 min-h-0">
          {isTerminalOnly ? (
            <div className="h-full relative">
              {renderTerminal()}
              <button
                onClick={() => saveSessionTabVisibility({ ...globalTabVisibility })}
                className="absolute top-2 right-2 px-2 py-1 rounded bg-bg-surface/80 border border-border-default text-text-tertiary hover:text-text-primary text-xs transition-colors backdrop-blur-sm"
                title="Show side panels"
              >
                Tabs
              </button>
            </div>
          ) : (
            <ResizablePanes
              left={renderTerminal()}
              right={renderRightPanel()}
              defaultLeftWidth={50}
              minLeftWidth={25}
              maxLeftWidth={75}
              storageKey="lumbergh:mainSplitWidth"
            />
          )}
        </main>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Tab navigation with back button */}
          <div className="flex gap-1 px-2 py-1 bg-bg-surface border-b border-border-default overflow-x-auto scrollbar-hide">
            {/* Back button */}
            <button
              onClick={() => navigate('/')}
              className="shrink-0 px-2 py-1.5 text-text-tertiary hover:text-text-primary transition-colors"
              title="Back to Dashboard"
            >
              <ArrowLeft size={16} />
            </button>
            {/* Separator */}
            <div className="w-px shrink-0 bg-border-default my-1" />
            {visibleMobileTabs.map((tab) => (
              <button
                key={tab.id}
                data-testid={`tab-${tab.id === 'todos' ? 'todo' : tab.id}`}
                onClick={() => {
                  setMobileTab(tab.id)
                  if (tab.id === 'git') setGitTabResetTrigger((n) => n + 1)
                }}
                className={`shrink-0 px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  mobileTab === tab.id
                    ? 'bg-control-bg-hover text-text-primary'
                    : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
                }`}
              >
                {tab.label}
                {tab.id === 'git' && diffStats && diffStats.files > 0 && (
                  <span className="ml-1 text-xs">
                    ({diffStats.files})
                    <span className="text-green-400 ml-1">+{diffStats.additions}</span>
                    <span className="text-red-400 ml-1">-{diffStats.deletions}</span>
                  </span>
                )}
              </button>
            ))}
          </div>
          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {/* Terminal stays mounted to preserve WebSocket connection and buffer */}
            <div className={`h-full ${mobileTab === 'terminal' ? '' : 'hidden'}`}>
              {renderTerminal()}
            </div>
            {mobileTab === 'git' && (
              <GitTab
                sessionName={name}
                diffData={diffData}
                onRefreshDiff={() => fetchDiffData({ force: true })}
                onJumpToTodos={handleJumpToTodos}
                onFocusTerminal={handleFocusTerminal}
                resetTrigger={gitTabResetTrigger}
              />
            )}
            {mobileTab === 'files' && (
              <FileBrowser sessionName={name} onFocusTerminal={handleFocusTerminal} />
            )}
            {mobileTab === 'todos' && name && (
              <VerticalResizablePanes
                top={
                  <TodoList
                    sessionName={name}
                    onFocusTerminal={handleFocusTerminal}
                    onTodoSent={handleTodoSent}
                    onSwitchToTerminal={handleSwitchToTerminal}
                  />
                }
                bottom={<Scratchpad sessionName={name} onFocusTerminal={handleFocusTerminal} />}
                defaultTopHeight={50}
                minTopHeight={20}
                maxTopHeight={80}
                storageKey="lumbergh:todoSplitHeight"
              />
            )}
            {mobileTab === 'prompts' && (
              <PromptTemplates sessionName={name} onFocusTerminal={handleFocusTerminal} />
            )}
            {mobileTab === 'shared' && (
              <SharedFiles
                sessionName={name}
                onFocusTerminal={handleFocusTerminal}
                refreshTrigger={sharedRefreshTrigger}
              />
            )}
          </div>
        </div>
      )}
    </div>
  )
}
