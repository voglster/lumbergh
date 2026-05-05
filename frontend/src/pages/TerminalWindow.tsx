import { useParams, useNavigate } from 'react-router-dom'
import Terminal from '../components/Terminal'
import { getApiBase } from '../config'

export default function TerminalWindow() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()

  if (!name) return null

  const cycleSession = (direction: 'next' | 'prev') => {
    fetch(`${getApiBase()}/sessions`)
      .then((r) => r.json())
      .then((data) => {
        const sessions: { name: string }[] = data.sessions || []
        const idx = sessions.findIndex((s) => s.name === name)
        if (idx === -1 || sessions.length < 2) return
        const nextIdx =
          direction === 'next'
            ? (idx + 1) % sessions.length
            : (idx - 1 + sessions.length) % sessions.length
        navigate(`/session/${sessions[nextIdx].name}/term`, { replace: true })
      })
      .catch(() => {})
  }

  return (
    <div className="fixed inset-0 bg-bg-base">
      <Terminal sessionName={name} onCycleSession={cycleSession} />
    </div>
  )
}
