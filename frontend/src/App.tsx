import { useState, useEffect } from 'react'
import Terminal from './components/Terminal'
import QuickInput from './components/QuickInput'

interface Session {
  name: string
  id: string
  windows: number
  attached: boolean
}

function App() {
  const [sessions, setSessions] = useState<Session[]>([])
  const [selectedSession, setSelectedSession] = useState<string | null>(null)
  const [sendFn, setSendFn] = useState<((data: string) => void) | null>(null)

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

  const handleSendInput = (text: string) => {
    if (sendFn) {
      sendFn(text + '\n')
    }
  }

  return (
    <div className="h-full flex flex-col bg-gray-900 text-white">
      {/* Header with session selector */}
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

      {/* Terminal area */}
      <main className="flex-1 min-h-0">
        {selectedSession ? (
          <Terminal
            sessionName={selectedSession}
            apiHost={apiHost}
            onSendReady={setSendFn}
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select a tmux session to connect
          </div>
        )}
      </main>

      {/* Quick input at bottom */}
      <footer className="p-2 bg-gray-800 border-t border-gray-700">
        <QuickInput
          onSend={handleSendInput}
          disabled={!selectedSession || !sendFn}
        />
      </footer>
    </div>
  )
}

export default App
