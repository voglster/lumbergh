import { useState } from 'react'
import { useNavigate } from 'react-router-dom'

interface Session {
  name: string
  workdir: string | null
  description: string | null
  displayName: string | null
  alive: boolean
  attached: boolean
  windows: number
}

interface Props {
  session: Session
  onDelete: (name: string) => void
  onRename: (name: string, displayName: string) => void
}

export default function SessionCard({ session, onDelete, onRename }: Props) {
  const navigate = useNavigate()
  const [isEditing, setIsEditing] = useState(false)
  const [editValue, setEditValue] = useState(session.displayName || '')

  const handleClick = () => {
    if (!isEditing) {
      navigate(`/session/${session.name}`)
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm(`Delete session "${session.name}"?`)) {
      onDelete(session.name)
    }
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditValue(session.displayName || session.name)
    setIsEditing(true)
  }

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()
    const trimmedValue = editValue.trim()
    // Only save if different from current displayName (or name if no displayName)
    if (trimmedValue !== (session.displayName || '')) {
      onRename(session.name, trimmedValue)
    }
    setIsEditing(false)
  }

  const handleEditCancel = (e?: React.MouseEvent) => {
    e?.stopPropagation()
    setIsEditing(false)
    setEditValue(session.displayName || '')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleEditCancel()
    }
  }

  const displayTitle = session.displayName || session.name
  const showOriginalName = session.displayName && session.displayName !== session.name

  return (
    <div
      onClick={handleClick}
      className="bg-gray-800 rounded-lg p-4 cursor-pointer hover:bg-gray-700 transition-colors border border-gray-700 hover:border-gray-600"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${session.alive ? 'bg-green-500' : 'bg-gray-500'}`}
          />
          {isEditing ? (
            <form onSubmit={handleEditSubmit} className="flex-1 min-w-0" onClick={(e) => e.stopPropagation()}>
              <input
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onKeyDown={handleKeyDown}
                onBlur={() => handleEditCancel()}
                autoFocus
                className="w-full bg-gray-700 text-white px-2 py-1 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-sm"
                placeholder={session.name}
              />
            </form>
          ) : (
            <div className="flex-1 min-w-0">
              <h3 className="font-semibold text-white truncate">{displayTitle}</h3>
              {showOriginalName && (
                <p className="text-xs text-gray-500 truncate">{session.name}</p>
              )}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          {!isEditing && (
            <button
              onClick={handleEditClick}
              className="text-gray-500 hover:text-blue-400 transition-colors p-1"
              title="Rename session"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"
                />
              </svg>
            </button>
          )}
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
