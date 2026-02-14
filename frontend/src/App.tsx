import { useState, useEffect, useRef, useCallback } from 'react'
import Terminal from './components/Terminal'
import DiffViewer from './components/DiffViewer'
import FileBrowser from './components/FileBrowser'
import ResizablePanes from './components/ResizablePanes'
import VerticalResizablePanes from './components/VerticalResizablePanes'
import TodoList from './components/TodoList'
import Scratchpad from './components/Scratchpad'
import PromptTemplates from './components/PromptTemplates'

interface Session {
  name: string
  id: string
  windows: number
  attached: boolean
}

type RightPanel = 'diff' | 'files' | 'todos' | 'prompts'
type MobileTab = 'terminal' | 'diff' | 'files' | 'todos' | 'prompts'

function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [rightPanel, setRightPanel] = useState<RightPanel>(() => {
    const saved = localStorage.getItem('lumbergh:rightPanel')
    if (saved === 'diff' || saved === 'files' || saved === 'todos' || saved === 'prompts') {
      return saved
    }
    return 'diff'
  })
  const [mobileTab, setMobileTab] = useState<MobileTab>('terminal')
  const [diffStats, setDiffStats] = useState<{files: number, additions: number, deletions: number} | null>(null)
  const [diffKey, setDiffKey] = useState(0)
  const focusFnRef = useRef<(() => void) | null>(null)

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

  const handleCommitSuccess = useCallback(() => {
    setRightPanel('todos')
    setMobileTab('todos')
  }, [])

  // Determine API host - use same hostname but port 8000 for backend
  const apiHost = `${window.location.hostname}:8000`

  const fetchDiffStats = useCallback(async () => {
    try {
      const res = await fetch(`http://${apiHost}/api/git/diff`)
      const data = await res.json()
      setDiffStats({
        files: data.files?.length || 0,
        additions: data.stats?.additions || 0,
        deletions: data.stats?.deletions || 0,
      })
    } catch (err) {
      console.error('Failed to fetch diff stats:', err)
    }
  }, [apiHost])

  // Poll for diff stats every 5 seconds
  useEffect(() => {
    fetchDiffStats()
    const interval = setInterval(fetchDiffStats, 5000)
    return () => clearInterval(interval)
  }, [fetchDiffStats])

  useEffect(() => {
    // Fetch available sessions
    fetch(`http://${apiHost}/api/sessions`)
      .then(res => res.json())
      .then(data => {
        setSessions(data.sessions || [])
        // Auto-select first session if available
        if (data.sessions?.length > 0 && !selectedSession) {
          setSelectedSession(data.sessions[0].name)
        }
      })
      .catch(err => console.error('Failed to fetch sessions:', err))
  }, [apiHost])

  const mobileTabs: { id: MobileTab; label: string }[] = [
    { id: 'terminal', label: 'Terminal' },
    { id: 'diff', label: 'Diff' },
    { id: 'files', label: 'Files' },
    { id: 'todos', label: 'Todo' },
    { id: 'prompts', label: 'Prompts' },
  ]

  const renderTerminal = () => (
    <div className="h-full">
      {selectedSession ? (
        <Terminal
          sessionName={selectedSession}
          apiHost={apiHost}
          onFocusReady={handleFocusReady}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-gray-500">
          Select a tmux session to connect
        </div>
      )}
    </div>
  )

  const renderRightPanel = () => (
    <div className="h-full flex flex-col">
      {/* Panel switcher */}
      <div className="flex gap-1 p-2 bg-gray-800 border-b border-gray-700">
        <button
          onClick={() => { setRightPanel('diff'); setDiffKey(k => k + 1) }}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'diff'
              ? 'bg-gray-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
          }`}
        >
          Diff
          {diffStats && diffStats.files > 0 && (
            <span className="ml-2 text-xs">
              ({diffStats.files})
              <span className="text-green-400 ml-1">+{diffStats.additions}</span>
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
      </div>
      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {rightPanel === 'diff' && <DiffViewer key={diffKey} apiHost={apiHost} onCommitSuccess={handleCommitSuccess} />}
        {rightPanel === 'files' && <FileBrowser apiHost={apiHost} />}
        {rightPanel === 'todos' && (
          <VerticalResizablePanes
            top={<TodoList apiHost={apiHost} sessionName={selectedSession} onFocusTerminal={handleFocusTerminal} />}
            bottom={<Scratchpad apiHost={apiHost} />}
            defaultTopHeight={50}
            minTopHeight={20}
            maxTopHeight={80}
            storageKey="lumbergh:todoSplitHeight"
          />
        )}
        {rightPanel === 'prompts' && (
          <PromptTemplates apiHost={apiHost} sessionName={selectedSession} onFocusTerminal={handleFocusTerminal} />
        )}
      </div>
    </div>
  )

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      {/* Header */}
      <header className="flex items-center gap-4 p-2 bg-gray-800 border-b border-gray-700">
        <h1 className="text-lg font-semibold text-gray-200">Lumbergh</h1>
        <select
          value={selectedSession || ''}
          onChange={(e) => setSelectedSession(e.target.value || null)}
          className="bg-gray-700 text-white px-2 py-1 rounded border border-gray-600"
        >
          <option value="">Select session...</option>
          {sessions.map(s => (
            <option key={s.id} value={s.name}>
              {s.name} ({s.windows} windows)
            </option>
          ))}
        </select>
      </header>

      {/* Desktop layout: resizable side-by-side panes */}
      <main className="flex-1 min-h-0 hidden md:block">
        <ResizablePanes
          left={renderTerminal()}
          right={renderRightPanel()}
          defaultLeftWidth={50}
          minLeftWidth={25}
          maxLeftWidth={75}
          storageKey="lumbergh:mainSplitWidth"
        />
      </main>

      {/* Mobile layout: tabs */}
      <div className="flex-1 min-h-0 flex flex-col md:hidden">
        {/* Tab navigation */}
        <div className="flex gap-1 px-2 py-1 bg-gray-800 border-b border-gray-700">
          {mobileTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => { setMobileTab(tab.id); if (tab.id === 'diff') setDiffKey(k => k + 1) }}
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
          {mobileTab === 'terminal' && renderTerminal()}
          {mobileTab === 'diff' && <DiffViewer key={diffKey} apiHost={apiHost} onCommitSuccess={handleCommitSuccess} />}
          {mobileTab === 'files' && <FileBrowser apiHost={apiHost} />}
          {mobileTab === 'todos' && (
            <VerticalResizablePanes
              top={<TodoList apiHost={apiHost} sessionName={selectedSession} onFocusTerminal={handleFocusTerminal} />}
              bottom={<Scratchpad apiHost={apiHost} />}
              defaultTopHeight={50}
              minTopHeight={20}
              maxTopHeight={80}
              storageKey="lumbergh:todoSplitHeight"
            />
          )}
          {mobileTab === 'prompts' && (
            <PromptTemplates apiHost={apiHost} sessionName={selectedSession} onFocusTerminal={handleFocusTerminal} />
          )}
        </div>
      </div>
    </div>
  )
}

export default App
