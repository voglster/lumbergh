import { GitBranch, Bot, Zap } from 'lucide-react'

const PROVIDER_LABELS: Record<string, string> = {
  'claude-code': 'Claude Code',
  cursor: 'Cursor',
  opencode: 'OpenCode',
  'gemini-cli': 'Gemini CLI',
  aider: 'Aider',
  codex: 'Codex CLI',
}

interface Props {
  type?: 'direct' | 'worktree' | 'scratch'
  worktreeBranch?: string | null
  worktreeParentRepo?: string | null
  agentProvider?: string | null
  workdir?: string | null
  description?: string | null
  status?: string | null
}

export default function SessionCardBadges({
  type,
  worktreeBranch,
  worktreeParentRepo,
  agentProvider,
  workdir,
  description,
  status,
}: Props) {
  return (
    <>
      {type === 'scratch' && (
        <div className="flex items-center gap-1.5 mb-1">
          <Zap size={14} className="text-amber-400" />
          <span className="text-xs text-amber-400 font-medium">Scratch</span>
        </div>
      )}

      {type === 'worktree' && worktreeBranch && (
        <div className="flex items-center gap-1.5 mb-1">
          <GitBranch size={14} className="text-purple-400" />
          <span className="text-xs text-purple-400 font-mono">{worktreeBranch}</span>
          {worktreeParentRepo && (
            <span className="text-xs text-text-muted">
              from {worktreeParentRepo.split('/').pop()}
            </span>
          )}
        </div>
      )}

      {agentProvider && (
        <div className="flex items-center gap-1.5 mb-1">
          <Bot size={14} className="text-cyan-400" />
          <span className="text-xs text-cyan-400">
            {PROVIDER_LABELS[agentProvider] || agentProvider}
          </span>
        </div>
      )}

      {workdir && (
        <p className="text-sm text-text-tertiary font-mono truncate mb-1" title={workdir}>
          {workdir}
        </p>
      )}

      {description && <p className="text-sm text-text-muted truncate mb-1">{description}</p>}

      {status && <p className="text-sm text-blue-400 truncate mb-2 italic">{status}</p>}
    </>
  )
}
