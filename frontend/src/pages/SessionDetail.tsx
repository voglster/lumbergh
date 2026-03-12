import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'
import { getApiBase } from '../config'
import Terminal from '../components/Terminal'
import FileBrowser from '../components/FileBrowser'
import ResizablePanes from '../components/ResizablePanes'
import VerticalResizablePanes from '../components/VerticalResizablePanes'
import TodoList from '../components/TodoList'
import Scratchpad from '../components/Scratchpad'
import PromptTemplates from '../components/PromptTemplates'
import SharedFiles from '../components/SharedFiles'
import GitTab from '../components/graph/GitTab'
import { useIsDesktop } from '../hooks/useMediaQuery'

type RightPanel = 'git' | 'files' | 'todos' | 'prompts' | 'shared'
type MobileTab = 'terminal' | 'git' | 'files' | 'todos' | 'prompts' | 'shared'

type DiffData = {
  files: Array<{ path: string; diff: string }>
  stats: { additions: number; deletions: number }
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
  const focusFnRef = useRef<(() => void) | null>(null)

  // Touch session to track last used time
  useEffect(() => {
    if (name) {
      fetch(`${getApiBase()}/sessions/${name}/touch`, { method: 'POST' }).catch(() => {})
    }
  }, [name])

  // Persist right panel selection
  useEffect(() => {
    localStorage.setItem('lumbergh:rightPanel', rightPanel)
  }, [rightPanel])

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
    setRightPanel('todos')
    setMobileTab('todos')
  }, [])

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

  const fetchDiffData = useCallback(async () => {
    if (!name) return
    try {
      const res = await fetch(`${getApiBase()}/sessions/${name}/git/diff`)
      const data = await res.json()
      // Only update state if data actually changed to prevent scroll resets
      setDiffData((prev) => (diffDataEquals(prev, data) ? prev : data))
    } catch (err) {
      console.error('Failed to fetch diff data:', err)
    }
  }, [name])

  // Lightweight stats for tab badges (polled always)
  const [diffStats, setDiffStats] = useState<{
    files: number
    additions: number
    deletions: number
  } | null>(null)

  // Is the git tab currently visible? (need to poll full diff data when visible)
  const isDiffVisible = isDesktop ? rightPanel === 'git' : mobileTab === 'git'

  // Poll lightweight diff-stats every 10s (for badge counts)
  useEffect(() => {
    if (!name) return
    const fetchStats = async () => {
      try {
        const res = await fetch(`${getApiBase()}/sessions/${name}/git/diff-stats`)
        const data = await res.json()
        // Only update state if values actually changed to avoid re-renders
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

  const mobileTabs: { id: MobileTab; label: string }[] = [
    { id: 'terminal', label: 'Terminal' },
    { id: 'git', label: 'Git' },
    { id: 'files', label: 'Files' },
    { id: 'todos', label: 'Todo' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'shared', label: 'Shared' },
  ]

  const renderTerminal = () => (
    <div className="h-full" data-testid="terminal-container">
      {name ? (
        <Terminal
          sessionName={name}
          onFocusReady={handleFocusReady}
          onBack={isDesktop ? () => navigate('/') : undefined}
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
        <button
          data-testid="tab-git"
          onClick={() => {
            setRightPanel('git')
            setGitTabResetTrigger((n) => n + 1)
          }}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'git'
              ? 'bg-control-bg-hover text-text-primary'
              : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
          }`}
        >
          Git
          {diffStats && diffStats.files > 0 && (
            <span className="ml-2 text-xs">
              ({diffStats.files})<span className="text-green-400 ml-1">+{diffStats.additions}</span>
              <span className="text-red-400 ml-1">-{diffStats.deletions}</span>
            </span>
          )}
        </button>
        <button
          data-testid="tab-files"
          onClick={() => setRightPanel('files')}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'files'
              ? 'bg-control-bg-hover text-text-primary'
              : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
          }`}
        >
          Files
        </button>
        <button
          data-testid="tab-todo"
          onClick={() => setRightPanel('todos')}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'todos'
              ? 'bg-control-bg-hover text-text-primary'
              : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
          }`}
        >
          Todo
        </button>
        <button
          data-testid="tab-prompts"
          onClick={() => setRightPanel('prompts')}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'prompts'
              ? 'bg-control-bg-hover text-text-primary'
              : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
          }`}
        >
          Prompts
        </button>
        <button
          data-testid="tab-shared"
          onClick={() => setRightPanel('shared')}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'shared'
              ? 'bg-control-bg-hover text-text-primary'
              : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
          }`}
        >
          Shared
        </button>
      </div>
      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {rightPanel === 'git' && (
          <GitTab
            sessionName={name}
            diffData={diffData}
            onRefreshDiff={fetchDiffData}
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

  return (
    <div className="h-full flex flex-col bg-bg-sunken text-text-primary">
      {/* Conditionally render only desktop OR mobile layout (not both) */}
      {isDesktop ? (
        <main className="flex-1 min-h-0">
          <ResizablePanes
            left={renderTerminal()}
            right={renderRightPanel()}
            defaultLeftWidth={50}
            minLeftWidth={25}
            maxLeftWidth={75}
            storageKey="lumbergh:mainSplitWidth"
          />
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
            {mobileTabs.map((tab) => (
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
                onRefreshDiff={fetchDiffData}
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
