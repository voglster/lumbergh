import { useNavigate } from 'react-router-dom'

interface Session {
  name: string
  workdir: string | null
  description: string | null
  alive: boolean
  attached: boolean
  windows: number
}

interface Props {
  session: Session
  onDelete: (name: string) => void
}

export default function SessionCard({ session, onDelete }: Props) {
  const navigate = useNavigate()

  const handleClick = () => {
    navigate(`/session/${session.name}`)
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm(`Delete session "${session.name}"?`)) {
      onDelete(session.name)
    }
  }

  return (
    <div
      onClick={handleClick}
      className="bg-gray-800 rounded-lg p-4 cursor-pointer hover:bg-gray-700 transition-colors border border-gray-700 hover:border-gray-600"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2">
          <span
            className={`w-2 h-2 rounded-full ${session.alive ? 'bg-green-500' : 'bg-gray-500'}`}
          />
          <h3 className="font-semibold text-white">{session.name}</h3>
        </div>
        <button
          onClick={handleDelete}
          className="text-gray-500 hover:text-red-400 transition-colors p-1"
          title="Delete session"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>
      </div>

      {session.workdir && (
        <p className="text-sm text-gray-400 font-mono truncate mb-1" title={session.workdir}>
          {session.workdir}
        </p>
      )}

      {session.description && (
        <p className="text-sm text-gray-500 truncate mb-2">{session.description}</p>
      )}

      <div className="flex items-center gap-3 text-xs text-gray-500">
        <span>
          {session.windows} window{session.windows !== 1 ? 's' : ''}
        </span>
        {session.attached && <span className="text-blue-400">attached</span>}
        {!session.workdir && <span className="text-yellow-500">orphan</span>}
      </div>
    </div>
  )
}
