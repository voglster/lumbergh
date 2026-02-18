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
  status?: string | null
  statusUpdatedAt?: string | null
  idleState?: 'unknown' | 'idle' | 'working' | 'error' | 'stalled' | null
  idleStateUpdatedAt?: string | null
  type?: 'direct' | 'worktree'
  worktreeParentRepo?: string | null
  worktreeBranch?: string | null
}

function getSessionStatus(session: Session) {
  if (!session.alive) {
    return { color: 'gray', pulse: false, label: 'Offline', icon: '\u2014' }
  }
  switch (session.idleState) {
    case 'idle':
      return { color: 'yellow', pulse: true, label: 'Waiting for input', icon: '\u23F8' }
    case 'working':
      return { color: 'green', pulse: false, label: 'Working', icon: '\u25B6' }
    case 'error':
      return { color: 'red', pulse: true, label: 'Error', icon: '!' }
    case 'stalled':
      return { color: 'red', pulse: true, label: 'Stalled', icon: '\u26A0' }
    default:
      return { color: 'green', pulse: false, label: 'Active', icon: '\u25CF' }
  }
}

const statusColorClasses: Record<string, { dot: string; text: string }> = {
  gray: { dot: 'bg-gray-500', text: 'text-gray-400' },
  yellow: { dot: 'bg-yellow-400', text: 'text-yellow-400' },
  green: { dot: 'bg-green-500', text: 'text-green-400' },
  red: { dot: 'bg-red-500', text: 'text-red-400' },
}

interface SessionUpdate {
  displayName?: string
  description?: string
}

interface Props {
  session: Session
  onDelete: (name: string, cleanupWorktree?: boolean) => void
  onUpdate: (name: string, updates: SessionUpdate) => void
  onReset: (name: string) => void
}

export default function SessionCard({ session, onDelete, onUpdate, onReset }: Props) {
  const navigate = useNavigate()
  const [isEditing, setIsEditing] = useState(false)
  const [editName, setEditName] = useState(session.displayName || '')
  const [editDescription, setEditDescription] = useState(session.description || '')

  const handleClick = () => {
    if (!isEditing) {
      navigate(`/session/${session.name}`)
    }
  }

  const handleDelete = (e: React.MouseEvent) => {
    e.stopPropagation()

    if (session.type === 'worktree') {
      // For worktree sessions, ask if user wants to cleanup worktree too
      const choice = confirm(
        `Delete session "${session.name}"?\n\nThis is a worktree session. Click OK to delete session only, or cancel and use the cleanup option.`
      )
      if (choice) {
        // Ask about worktree cleanup
        const cleanup = confirm(
          'Also delete the worktree directory? This will remove the checkout at:\n' +
          session.workdir
        )
        onDelete(session.name, cleanup)
      }
    } else {
      if (confirm(`Delete session "${session.name}"?`)) {
        onDelete(session.name)
      }
    }
  }

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (confirm(`⚠️ Reset "${session.name}"?\n\nThis will:\n• Close ALL tmux windows and terminals\n• Kill any running processes\n• Start a fresh Claude session\n\nAny unsaved work will be lost!`)) {
      onReset(session.name)
    }
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setEditName(session.displayName || session.name)
    setEditDescription(session.description || '')
    setIsEditing(true)
  }

  const handleEditSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const updates: SessionUpdate = {}
    const trimmedName = editName.trim()
    const trimmedDesc = editDescription.trim()

    // Only include changed fields
    if (trimmedName !== (session.displayName || '')) {
      updates.displayName = trimmedName
    }
    if (trimmedDesc !== (session.description || '')) {
      updates.description = trimmedDesc
    }

    if (Object.keys(updates).length > 0) {
      onUpdate(session.name, updates)
    }
    setIsEditing(false)
  }

  const handleEditCancel = () => {
    setIsEditing(false)
    setEditName(session.displayName || '')
    setEditDescription(session.description || '')
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      handleEditCancel()
    }
  }

  const displayTitle = session.displayName || session.name
  const showOriginalName = session.displayName && session.displayName !== session.name

  if (isEditing) {
    return (
      <div
        onClick={(e) => e.stopPropagation()}
        className="bg-gray-800 rounded-lg p-4 border border-blue-500"
      >
        <form onSubmit={handleEditSubmit} className="space-y-3">
          <div>
            <label className="block text-xs text-gray-400 mb-1">Display Name</label>
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              onKeyDown={handleKeyDown}
              autoFocus
              className="w-full bg-gray-700 text-white px-2 py-1.5 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-sm"
              placeholder={session.name}
            />
          </div>
          <div>
            <label className="block text-xs text-gray-400 mb-1">Description</label>
            <input
              type="text"
              value={editDescription}
              onChange={(e) => setEditDescription(e.target.value)}
              onKeyDown={handleKeyDown}
              className="w-full bg-gray-700 text-white px-2 py-1.5 rounded border border-gray-600 focus:border-blue-500 focus:outline-none text-sm"
              placeholder="Optional description"
            />
          </div>
          <div className="flex justify-end gap-2">
            <button
              type="button"
              onClick={handleEditCancel}
              className="px-3 py-1 text-sm text-gray-400 hover:text-white transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
            >
              Save
            </button>
          </div>
        </form>
      </div>
    )
  }

  const status = getSessionStatus(session)
  const colors = statusColorClasses[status.color]

  return (
    <div
      onClick={handleClick}
      className="bg-gray-800 rounded-lg p-4 cursor-pointer hover:bg-gray-700 transition-colors border border-gray-700 hover:border-gray-600"
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${colors.dot} ${status.pulse ? 'animate-pulse' : ''}`}
            title={status.label}
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-white truncate">{displayTitle}</h3>
            {showOriginalName && (
              <p className="text-xs text-gray-500 truncate">{session.name}</p>
            )}
          </div>
        </div>
        <div className="flex items-center gap-1 flex-shrink-0">
          <button
            onClick={handleEditClick}
            className="text-gray-500 hover:text-blue-400 transition-colors p-1"
            title="Edit session"
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
          {session.alive && (
            <button
              onClick={handleReset}
              className="text-gray-500 hover:text-yellow-400 transition-colors p-1"
              title="Reset session"
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
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

      {/* Worktree indicator */}
      {session.type === 'worktree' && session.worktreeBranch && (
        <div className="flex items-center gap-1.5 mb-1">
          <svg className="w-3.5 h-3.5 text-purple-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 7l5 5m0 0l-5 5m5-5H6" />
          </svg>
          <span className="text-xs text-purple-400 font-mono">{session.worktreeBranch}</span>
          {session.worktreeParentRepo && (
            <span className="text-xs text-gray-500">
              from {session.worktreeParentRepo.split('/').pop()}
            </span>
          )}
        </div>
      )}

      {session.workdir && (
        <p className="text-sm text-gray-400 font-mono truncate mb-1" title={session.workdir}>
          {session.workdir}
        </p>
      )}

      {session.description && (
        <p className="text-sm text-gray-500 truncate mb-1">{session.description}</p>
      )}

      {session.status && (
        <p className="text-sm text-blue-400 truncate mb-2 italic">{session.status}</p>
      )}

      {session.alive && session.idleState && session.idleState !== 'unknown' && (
        <div className={`flex items-center gap-1.5 ${colors.text} text-xs mb-2`}>
          <span>{status.icon}</span>
          <span>{status.label}</span>
        </div>
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
