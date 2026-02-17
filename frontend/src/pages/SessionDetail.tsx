import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
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

  // Determine API host - use same hostname but port 8000 for backend
  const apiHost = `${window.location.hostname}:8000`

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

  // Compute stats from full diff data for tab badges
  const diffStats = diffData
    ? {
        files: diffData.files?.length || 0,
        additions: diffData.stats?.additions || 0,
        deletions: diffData.stats?.deletions || 0,
      }
    : null

  // Poll for diff data every 5 seconds
  useEffect(() => {
    // Defer initial fetch to avoid synchronous setState in effect
    const timeoutId = setTimeout(fetchDiffData, 0)
    const interval = setInterval(fetchDiffData, 5000)
    return () => {
      clearTimeout(timeoutId)
      clearInterval(interval)
    }
  }, [fetchDiffData])

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
          isVisible={isDesktop || mobileTab === 'terminal'}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-gray-500">
          No session selected
        </div>
      )}
    </div>
  )

  const renderRightPanel = () => (
    <div className="h-full flex flex-col">
      {/* Panel switcher */}
      <div className="flex gap-1 p-2 bg-gray-800 border-b border-gray-700">
        <button
          onClick={() => {
            setRightPanel('diff')
            setDiffKey((k) => k + 1)
          }}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'diff'
              ? 'bg-gray-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
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
              ? 'bg-gray-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
          }`}
        >
          Files
        </button>
        <button
          onClick={() => setRightPanel('todos')}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'todos'
              ? 'bg-gray-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
          }`}
        >
          Todo
        </button>
        <button
          onClick={() => setRightPanel('prompts')}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'prompts'
              ? 'bg-gray-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
          }`}
        >
          Prompts
        </button>
        <button
          onClick={() => setRightPanel('shared')}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'shared'
              ? 'bg-gray-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
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
    <div className="h-full flex flex-col bg-gray-900 text-white">
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
          <div className="flex gap-1 px-2 py-1 bg-gray-800 border-b border-gray-700">
            {/* Back button */}
            <button
              onClick={() => navigate('/')}
              className="px-2 py-1.5 text-gray-400 hover:text-white transition-colors"
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
            <div className="w-px bg-gray-700 my-1" />
            {mobileTabs.map((tab) => (
              <button
                key={tab.id}
                onClick={() => {
                  setMobileTab(tab.id)
                  if (tab.id === 'diff') setDiffKey((k) => k + 1)
                }}
                className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                  mobileTab === tab.id
                    ? 'bg-gray-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
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
