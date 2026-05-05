import { Pause, Play, Pencil, RefreshCw, X } from 'lucide-react'

interface Props {
  alive: boolean
  paused?: boolean
  onTogglePaused: (e: React.MouseEvent) => void
  onEdit: (e: React.MouseEvent) => void
  onReset: (e: React.MouseEvent) => void
  onDelete: (e: React.MouseEvent) => void
}

export default function SessionCardActions({
  alive,
  paused,
  onTogglePaused,
  onEdit,
  onReset,
  onDelete,
}: Props) {
  return (
    <div className="flex items-center gap-1 flex-shrink-0">
      <button
        onClick={onTogglePaused}
        className={`transition-colors p-1 ${paused || !alive ? 'text-yellow-400 hover:text-green-400' : 'text-text-muted hover:text-yellow-400'}`}
        title={!alive ? 'Restart session' : paused ? 'Resume session' : 'Pause session'}
      >
        {paused || !alive ? <Play size={16} /> : <Pause size={16} />}
      </button>
      <button
        onClick={onEdit}
        data-testid="session-edit-btn"
        className="text-text-muted hover:text-blue-400 transition-colors p-1"
        title="Edit session"
      >
        <Pencil size={16} />
      </button>
      {alive && (
        <button
          onClick={onReset}
          className="text-text-muted hover:text-yellow-400 transition-colors p-1"
          title="Reset session"
        >
          <RefreshCw size={16} />
        </button>
      )}
      <button
        onClick={onDelete}
        data-testid="session-delete-btn"
        className="text-text-muted hover:text-red-400 transition-colors p-1"
        title="Delete session"
      >
        <X size={16} />
      </button>
    </div>
  )
}
