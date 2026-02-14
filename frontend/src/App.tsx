import { useState, useEffect, useRef, useCallback } from 'react'
import Terminal from './components/Terminal'
import QuickInput from './components/QuickInput'
import DiffViewer from './components/DiffViewer'
import FileBrowser from './components/FileBrowser'
import ResizablePanes from './components/ResizablePanes'
import TodoList from './components/TodoList'
import Scratchpad from './components/Scratchpad'

interface Session {
  name: string
  id: string
  windows: number
  attached: boolean
}

type RightPanel = 'diff' | 'files' | 'todos'
type MobileTab = 'terminal' | 'diff' | 'files' | 'todos'

function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [rightPanel, setRightPanel] = useState<RightPanel>('diff')
  const [mobileTab, setMobileTab] = useState<MobileTab>('terminal')
  const sendFnRef = useRef<((data: string) => void) | null>(null)

  const handleSendReady = useCallback((fn: ((data: string) => void) | null) => {
    sendFnRef.current = fn
  }, [])

  const handleSendInput = useCallback((text: string) => {
    if (sendFnRef.current) {
      sendFnRef.current(text + '\n')
    }
  }, [])

  // Determine API host - use same hostname but port 8000 for backend
  const apiHost = `${window.location.hostname}:8000`

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
  ]

  const renderTerminal = () => (
    <div className="h-full flex flex-col">
      <div className="flex-1 min-h-0">
        {selectedSession ? (
          <Terminal
            sessionName={selectedSession}
            apiHost={apiHost}
            onSendReady={handleSendReady}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select a tmux session to connect
          </div>
        )}
      </div>
      <div className="p-2 bg-gray-800 border-t border-gray-700">
        <QuickInput
          onSend={handleSendInput}
          disabled={!selectedSession}
        />
      </div>
    </div>
  )

  const renderRightPanel = () => (
    <div className="h-full flex flex-col">
      {/* Panel switcher */}
      <div className="flex gap-1 p-2 bg-gray-800 border-b border-gray-700">
        <button
          onClick={() => setRightPanel('diff')}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === 'diff'
              ? 'bg-gray-600 text-white'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
          }`}
        >
          Diff
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
      </div>
      {/* Panel content */}
      <div className="flex-1 min-h-0 overflow-hidden">
        {rightPanel === 'diff' && <DiffViewer apiHost={apiHost} />}
        {rightPanel === 'files' && <FileBrowser apiHost={apiHost} />}
        {rightPanel === 'todos' && (
          <div className="h-full flex flex-col">
            <div className="h-1/2 border-b border-gray-700 overflow-auto">
              <TodoList apiHost={apiHost} />
            </div>
            <div className="h-1/2">
              <Scratchpad apiHost={apiHost} />
            </div>
          </div>
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
        />
      </main>

      {/* Mobile layout: tabs */}
      <div className="flex-1 min-h-0 flex flex-col md:hidden">
        {/* Tab navigation */}
        <div className="flex gap-1 px-2 py-1 bg-gray-800 border-b border-gray-700">
          {mobileTabs.map(tab => (
            <button
              key={tab.id}
              onClick={() => setMobileTab(tab.id)}
              className={`px-4 py-1.5 rounded text-sm font-medium transition-colors ${
                mobileTab === tab.id
                  ? 'bg-gray-600 text-white'
                  : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
        {/* Tab content */}
        <div className="flex-1 min-h-0 overflow-hidden">
          {mobileTab === 'terminal' && renderTerminal()}
          {mobileTab === 'diff' && <DiffViewer apiHost={apiHost} />}
          {mobileTab === 'files' && <FileBrowser apiHost={apiHost} />}
          {mobileTab === 'todos' && (
            <div className="h-full flex flex-col">
              <div className="h-1/2 border-b border-gray-700 overflow-auto">
                <TodoList apiHost={apiHost} />
              </div>
              <div className="h-1/2">
                <Scratchpad apiHost={apiHost} />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export default App
