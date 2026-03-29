import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { getApiBase } from '../config'
import { Minus, Pause, Play, AlertCircle, AlertTriangle, Circle, Cloud } from 'lucide-react'
import SessionCardEditForm from './SessionCardEditForm'
import SessionCardActions from './SessionCardActions'
import SessionCardBadges from './SessionCardBadges'
import type { SessionBase } from '../utils/sessionStatus'
import { getSessionStatus as getBaseStatus, statusColorClasses } from '../utils/sessionStatus'

interface Session extends SessionBase {
  workdir: string | null
  description: string | null
  attached: boolean
  windows: number
  status?: string | null
  statusUpdatedAt?: string | null
  idleStateUpdatedAt?: string | null
  type?: 'direct' | 'worktree'
  worktreeParentRepo?: string | null
  worktreeBranch?: string | null
  agentProvider?: string | null
  tabVisibility?: Record<string, boolean> | null
  cloudEnabled?: boolean
}

const statusIcons = {
  gray: Minus,
  yellow: Pause,
  green: Circle,
  red: AlertCircle,
} as const

function getSessionStatus(session: Session) {
  const base = getBaseStatus(session)
  let Icon = statusIcons[base.color as keyof typeof statusIcons] || Circle
  // Refine icons for specific states
  if (session.idleState === 'working') Icon = Play
  if (session.idleState === 'stalled') Icon = AlertTriangle
  return { ...base, Icon }
}

interface SessionUpdate {
  displayName?: string
  description?: string
  paused?: boolean
  agentProvider?: string
  cloudEnabled?: boolean
}

function SessionCardFooter({
  session,
  cloudAtLimit,
  onToggleCloud,
}: {
  session: Pick<Session, 'windows' | 'attached' | 'workdir' | 'cloudEnabled'>
  cloudAtLimit?: boolean
  onToggleCloud: (e: React.MouseEvent) => void
}) {
  return (
    <div className="flex items-center gap-3 text-xs text-text-muted">
      <span>
        {session.windows} window{session.windows !== 1 ? 's' : ''}
      </span>
      {session.attached && <span className="text-blue-400">attached</span>}
      {!session.workdir && <span className="text-yellow-500">orphan</span>}
      <button
        onClick={onToggleCloud}
        className={`ml-auto p-0.5 rounded transition-colors ${
          session.cloudEnabled
            ? 'text-blue-400 hover:text-blue-300'
            : cloudAtLimit
              ? 'text-text-muted opacity-40 cursor-not-allowed'
              : 'text-text-muted hover:text-blue-400'
        }`}
        title={
          session.cloudEnabled
            ? 'Cloud enabled (click to disable)'
            : cloudAtLimit
              ? 'Cloud session limit reached'
              : 'Enable cloud access'
        }
      >
        <Cloud size={14} fill={session.cloudEnabled ? 'currentColor' : 'none'} />
      </button>
    </div>
  )
}

async function confirmDeleteSession(
  session: Pick<Session, 'name' | 'type' | 'workdir'>,
  onDelete: (name: string, cleanupWorktree?: boolean) => void
) {
  if (session.type === 'worktree') {
    let dirty = false
    try {
      const res = await fetch(`${getApiBase()}/sessions/${session.name}/git/status`)
      if (res.ok) {
        const data = await res.json()
        dirty = data.files && data.files.length > 0
      }
    } catch {
      // If we can't check, proceed with caution
    }

    const msg = dirty
      ? `Delete session "${session.name}" and its worktree?\n\n` +
        `WARNING: This worktree has uncommitted changes that will be lost.\n` +
        `${session.workdir}`
      : `Delete session "${session.name}" and its worktree?\n\n${session.workdir}`

    if (confirm(msg)) {
      onDelete(session.name, true)
    }
  } else {
    if (confirm(`Delete session "${session.name}"?`)) {
      onDelete(session.name)
    }
  }
}

interface Props {
  session: Session
  onDelete: (name: string, cleanupWorktree?: boolean) => void
  onUpdate: (name: string, updates: SessionUpdate) => void
  onReset: (name: string) => void
  cloudAtLimit?: boolean
}

export default function SessionCard({ session, onDelete, onUpdate, onReset, cloudAtLimit }: Props) {
  const navigate = useNavigate()
  const [isEditing, setIsEditing] = useState(false)

  const handleClick = () => {
    if (!isEditing) {
      navigate(`/session/${session.name}`)
    }
  }

  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation()
    await confirmDeleteSession(session, onDelete)
  }

  const handleReset = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (
      confirm(
        `⚠️ Reset "${session.name}"?\n\nThis will:\n• Close ALL tmux windows and terminals\n• Kill any running processes\n• Start a fresh Claude session\n\nAny unsaved work will be lost!`
      )
    ) {
      onReset(session.name)
    }
  }

  const handleTogglePaused = (e: React.MouseEvent) => {
    e.stopPropagation()
    onUpdate(session.name, { paused: !session.paused })
  }

  const handleToggleCloud = (e: React.MouseEvent) => {
    e.stopPropagation()
    if (!session.cloudEnabled && cloudAtLimit) return
    onUpdate(session.name, { cloudEnabled: !session.cloudEnabled })
  }

  const handleEditClick = (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsEditing(true)
  }

  const displayTitle = session.displayName || session.name
  const showOriginalName = session.displayName && session.displayName !== session.name

  if (isEditing) {
    return (
      <SessionCardEditForm
        sessionName={session.name}
        displayName={session.displayName}
        description={session.description}
        agentProvider={session.agentProvider ?? null}
        tabVisibility={session.tabVisibility ?? null}
        onSave={onUpdate}
        onCancel={() => setIsEditing(false)}
      />
    )
  }

  const status = getSessionStatus(session)
  const colors = statusColorClasses[status.color]

  return (
    <div
      onClick={handleClick}
      data-testid="session-card-link"
      className={`bg-bg-surface rounded-lg p-4 cursor-pointer hover:bg-bg-elevated transition-colors border border-border-default hover:border-border-subtle ${session.paused ? 'opacity-50' : ''}`}
    >
      <div className="flex items-start justify-between mb-2">
        <div className="flex items-center gap-2 flex-1 min-w-0">
          <span
            className={`w-2 h-2 rounded-full flex-shrink-0 ${colors.dot} ${status.pulse ? 'animate-pulse' : ''}`}
            title={status.label}
          />
          <div className="flex-1 min-w-0">
            <h3 className="font-semibold text-text-primary truncate">{displayTitle}</h3>
            {showOriginalName && <p className="text-xs text-text-muted truncate">{session.name}</p>}
          </div>
        </div>
        <SessionCardActions
          alive={session.alive}
          paused={session.paused}
          onTogglePaused={handleTogglePaused}
          onEdit={handleEditClick}
          onReset={handleReset}
          onDelete={handleDelete}
        />
      </div>

      <SessionCardBadges
        type={session.type}
        worktreeBranch={session.worktreeBranch}
        worktreeParentRepo={session.worktreeParentRepo}
        agentProvider={session.agentProvider}
        workdir={session.workdir}
        description={session.description}
        status={session.status}
      />

      {session.alive && session.idleState && session.idleState !== 'unknown' && (
        <div className={`flex items-center gap-1.5 ${colors.text} text-xs mb-2`}>
          <status.Icon size={14} />
          <span>{status.label}</span>
        </div>
      )}

      <SessionCardFooter
        session={session}
        cloudAtLimit={cloudAtLimit}
        onToggleCloud={handleToggleCloud}
      />
    </div>
  )
}
