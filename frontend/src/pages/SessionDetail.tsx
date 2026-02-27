import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { getApiHost } from '../config'
import Terminal from '../components/Terminal'
import DiffViewer from '../components/DiffViewer'
import FileBrowser from '../components/FileBrowser'
import ResizablePanes from '../components/ResizablePanes'
import VerticalResizablePanes from '../components/VerticalResizablePanes'
import TodoList from '../components/TodoList'
import Scratchpad from '../components/Scratchpad'
import PromptTemplates from '../components/PromptTemplates'
import SharedFiles from '../components/SharedFiles'
import { useIsDesktop } from '../hooks/useMediaQuery'

type RightPanel = 'diff' | 'files' | 'todos' | 'prompts' | 'shared'
type MobileTab = 'terminal' | 'diff' | 'files' | 'todos' | 'prompts' | 'shared'

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
    if (saved === 'diff' || saved === 'files' || saved === 'todos' || saved === 'prompts' || saved === 'shared') {
      return saved
    }
    return 'diff'
  })
  const [sharedRefreshTrigger, setSharedRefreshTrigger] = useState(0)
  const [mobileTab, setMobileTab] = useState<MobileTab>('terminal')
  const [diffData, setDiffData] = useState<DiffData | null>(null)
  const [diffKey, setDiffKey] = useState(0)
  const focusFnRef = useRef<(() => void) | null>(null)

  const apiHost = getApiHost()

  // Touch session to track last used time
  useEffect(() => {
    if (name) {
      fetch(`http://${apiHost}/api/sessions/${name}/touch`, { method: 'POST' }).catch(() => {})
    }
  }, [apiHost, name])

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

  const handleJumpToTodos = useCallback(() => {
    setRightPanel('todos')
    setMobileTab('todos')
  }, [])

  const handleTodoSent = useCallback(async (text: string) => {
    if (!name) return
    try {
      await fetch(`http://${apiHost}/api/sessions/${name}/status-summary`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text }),
      })
    } catch (err) {
      console.error('Failed to update status summary:', err)
    }
  }, [apiHost, name])

  const handleReset = useCallback(async () => {
    if (!name) return
    try {
      const res = await fetch(`http://${apiHost}/api/sessions/${name}/reset`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to reset session')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reset session')
    }
  }, [apiHost, name])

  const fetchDiffData = useCallback(async () => {
    if (!name) return
    try {
      const res = await fetch(`http://${apiHost}/api/sessions/${name}/git/diff`)
      const data = await res.json()
      // Only update state if data actually changed to prevent scroll resets
      setDiffData((prev) => (diffDataEquals(prev, data) ? prev : data))
    } catch (err) {
      console.error('Failed to fetch diff data:', err)
    }
  }, [apiHost, name])

  // Lightweight stats for tab badges (polled always)
  const [diffStats, setDiffStats] = useState<{
    files: number
    additions: number
    deletions: number
  } | null>(null)

  // Is the diff tab currently visible?
  const isDiffVisible = isDesktop ? rightPanel === 'diff' : mobileTab === 'diff'

  // Poll lightweight diff-stats every 10s (for badge counts)
  useEffect(() => {
    if (!name) return
    const fetchStats = async () => {
      try {
        const res = await fetch(`http://${apiHost}/api/sessions/${name}/git/diff-stats`)
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
  }, [apiHost, name])

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
            const res = await fetch(`http://${apiHost}/api/shared/upload`, {
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
  }, [apiHost])

  const mobileTabs: { id: MobileTab; label: string }[] = [
    { id: 'terminal', label: 'Terminal' },
    { id: 'diff', label: 'Diff' },
    { id: 'files', label: 'Files' },
    { id: 'todos', label: 'Todo' },
    { id: 'prompts', label: 'Prompts' },
    { id: 'shared', label: 'Shared' },
  ]

  const renderTerminal = () => (
    <div className="h-full">
      {name ? (
        <Terminal
          sessionName={name}
          apiHost={apiHost}
          onFocusReady={handleFocusReady}
          onBack={isDesktop ? () => navigate('/') : undefined}
          onReset={handleReset}
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
          onClick={() => {
            setRightPanel('diff')
            setDiffKey((k) => k + 1)
          }}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'diff'
              ? 'bg-control-bg-hover text-text-primary'
              : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
          }`}
        >
          Diff
          {diffStats && diffStats.files > 0 && (
            <span className="ml-2 text-xs">
              ({diffStats.files})<span className="text-green-400 ml-1">+{diffStats.additions}</span>
              <span className="text-red-400 ml-1">-{diffStats.deletions}</span>
            </span>
          )}
        </button>
        <button
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
        {rightPanel === 'diff' && (
          <DiffViewer
            key={diffKey}
            apiHost={apiHost}
            sessionName={name}
            diffData={diffData}
            onRefreshDiff={fetchDiffData}
            onJumpToTodos={handleJumpToTodos}
            onFocusTerminal={handleFocusTerminal}
          />
        )}
        {rightPanel === 'files' && (
          <FileBrowser apiHost={apiHost} sessionName={name} onFocusTerminal={handleFocusTerminal} />
        )}
        {rightPanel === 'todos' && name && (
          <VerticalResizablePanes
            top={
              <TodoList
                apiHost={apiHost}
                sessionName={name}
                onFocusTerminal={handleFocusTerminal}
                onTodoSent={handleTodoSent}
              />
            }
            bottom={
              <Scratchpad
                apiHost={apiHost}
                sessionName={name}
                onFocusTerminal={handleFocusTerminal}
              />
            }
            defaultTopHeight={50}
            minTopHeight={20}
            maxTopHeight={80}
            storageKey="lumbergh:todoSplitHeight"
          />
        )}
        {rightPanel === 'prompts' && (
          <PromptTemplates
            apiHost={apiHost}
            sessionName={name}
            onFocusTerminal={handleFocusTerminal}
          />
        )}
        {rightPanel === 'shared' && (
          <SharedFiles
            apiHost={apiHost}
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
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
            </button>
            {/* Separator */}
            <div className="w-px shrink-0 bg-border-default my-1" />
            {mobileTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setMobileTab(tab.id)
                  if (tab.id === 'diff') setDiffKey((k) => k + 1)
                }}
                className={`shrink-0 px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  mobileTab === tab.id
                    ? 'bg-control-bg-hover text-text-primary'
                    : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
                }`}
              >
                {tab.label}
                {tab.id === 'diff' && diffStats && diffStats.files > 0 && (
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
            {mobileTab === 'diff' && (
              <DiffViewer
                key={diffKey}
                apiHost={apiHost}
                sessionName={name}
                diffData={diffData}
                onRefreshDiff={fetchDiffData}
                onJumpToTodos={handleJumpToTodos}
                onFocusTerminal={handleFocusTerminal}
              />
            )}
            {mobileTab === 'files' && (
              <FileBrowser
                apiHost={apiHost}
                sessionName={name}
                onFocusTerminal={handleFocusTerminal}
              />
            )}
            {mobileTab === 'todos' && name && (
              <VerticalResizablePanes
                top={
                  <TodoList
                    apiHost={apiHost}
                    sessionName={name}
                    onFocusTerminal={handleFocusTerminal}
                    onTodoSent={handleTodoSent}
                  />
                }
                bottom={
                  <Scratchpad
                    apiHost={apiHost}
                    sessionName={name}
                    onFocusTerminal={handleFocusTerminal}
                  />
                }
                defaultTopHeight={50}
                minTopHeight={20}
                maxTopHeight={80}
                storageKey="lumbergh:todoSplitHeight"
              />
            )}
            {mobileTab === 'prompts' && (
              <PromptTemplates
                apiHost={apiHost}
                sessionName={name}
                onFocusTerminal={handleFocusTerminal}
              />
            )}
            {mobileTab === 'shared' && (
              <SharedFiles
                apiHost={apiHost}
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
