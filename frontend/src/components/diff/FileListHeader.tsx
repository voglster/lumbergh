import { useState, memo } from 'react'
import { Play, RefreshCw, Undo2, Maximize2, ArrowDown, CloudDownload } from 'lucide-react'
import { relativeDate } from '../../utils/relativeDate'
import type { DiffData } from './types'
import BranchSelector from './BranchSelector'
import BranchActions from './BranchActions'

interface RemoteStatus {
  branch?: string
  remote?: string
  ahead: number
  behind: number
  error?: string
  httpAuthWarning?: string
  fetchFailed?: boolean
}

interface Props {
  data: DiffData
  sessionName?: string
  commit?: {
    hash: string
    shortHash: string
    message: string
    author?: string
    relativeDate?: string
  } | null
  onRefresh: () => void
  onSendToTerminal?: (text: string, sendEnter: boolean) => void
  onExpand?: () => void
  remoteStatus?: RemoteStatus | null
  onFetch?: () => void
  onPull?: () => void
  isPulling?: boolean
  // Git action state
  gitBaseUrl: string
  isResetting: boolean
  isCommitting: boolean
  isGenerating: boolean
  isBranchOp: boolean
  hasChanges: boolean
  onReset: () => void
  onBranchAction: (targetBranch: string, type: 'rebase' | 'ff') => void
}

function RemoteButtons({
  remoteStatus,
  onFetch,
  onPull,
  isPulling,
}: {
  remoteStatus?: RemoteStatus | null
  onFetch?: () => void
  onPull?: () => void
  isPulling?: boolean
}) {
  if (remoteStatus && remoteStatus.behind > 0 && onPull) {
    return (
      <button
        onClick={onPull}
        disabled={isPulling}
        className="flex items-center gap-1 px-2 py-1 bg-yellow-600/80 hover:bg-yellow-500/80 disabled:bg-control-bg-hover disabled:cursor-not-allowed rounded text-sm text-white transition-colors"
        title={`${remoteStatus.behind} commit${remoteStatus.behind > 1 ? 's' : ''} behind ${remoteStatus.remote || 'origin'} — click to pull`}
      >
        <ArrowDown size={14} />
        <span className="text-xs">{remoteStatus.behind}</span>
      </button>
    )
  }
  if (onFetch) {
    return (
      <button
        onClick={onFetch}
        className="px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded text-sm transition-colors"
        title="Fetch from remote"
      >
        <CloudDownload size={16} />
      </button>
    )
  }
  return null
}

function CommitInfo({
  commit,
  onSendToTerminal,
}: {
  commit: NonNullable<Props['commit']>
  onSendToTerminal?: Props['onSendToTerminal']
}) {
  const [copiedSha, setCopiedSha] = useState(false)

  return (
    <>
      <span className="text-sm text-text-secondary truncate">
        <span
          className="text-blue-400 font-mono cursor-pointer hover:underline"
          title="Click to copy SHA"
          onClick={(e) => {
            e.stopPropagation()
            navigator.clipboard.writeText(commit.hash)
            setCopiedSha(true)
            setTimeout(() => setCopiedSha(false), 1500)
          }}
        >
          {commit.shortHash}
        </span>
        {copiedSha && <span className="ml-1 text-xs text-green-400">Copied!</span>}
        <span className="text-text-muted">: </span>
        <span className="text-text-tertiary">{commit.message}</span>
      </span>
      {onSendToTerminal && (
        <button
          onClick={() =>
            onSendToTerminal(
              `Review commit ${commit.shortHash}: "${commit.message}"\nRun \`git show ${commit.hash}\` to see the full diff.`,
              false
            )
          }
          className="text-sm text-text-muted hover:text-yellow-400 transition-colors shrink-0"
          title="Send commit info to terminal"
        >
          <Play size={16} />
        </button>
      )}
    </>
  )
}

const FileListHeader = memo(function FileListHeader({
  data,
  sessionName,
  commit,
  onRefresh,
  onSendToTerminal,
  onExpand,
  remoteStatus,
  onFetch,
  onPull,
  isPulling,
  gitBaseUrl,
  isResetting,
  isCommitting,
  isGenerating,
  isBranchOp,
  hasChanges,
  onReset,
  onBranchAction,
}: Props) {
  const isWorkingChanges = !commit

  return (
    <div className="flex items-center justify-between p-3 bg-bg-surface border-b border-border-default">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {isWorkingChanges ? (
            <span className="text-sm text-text-secondary truncate">Working Changes</span>
          ) : (
            <CommitInfo commit={commit} onSendToTerminal={onSendToTerminal} />
          )}
          {sessionName && (
            <>
              {isWorkingChanges && (
                <BranchSelector gitBaseUrl={gitBaseUrl} onBranchChange={onRefresh} />
              )}
              <BranchActions
                gitBaseUrl={gitBaseUrl}
                isBranchOp={isBranchOp}
                onBranchAction={onBranchAction}
              />
            </>
          )}
        </div>
        {!isWorkingChanges && commit?.author && (
          <div className="text-xs text-text-muted mt-0.5">
            {commit.author}
            {commit.relativeDate ? ` · ${relativeDate(commit.relativeDate)}` : ''}
          </div>
        )}
      </div>
      <div className="flex items-center gap-3 shrink-0 ml-2">
        <span className="text-green-400 text-sm">+{data.stats.additions}</span>
        <span className="text-red-400 text-sm">-{data.stats.deletions}</span>
        {isWorkingChanges && (
          <RemoteButtons
            remoteStatus={remoteStatus}
            onFetch={onFetch}
            onPull={onPull}
            isPulling={isPulling}
          />
        )}
        <button
          onClick={onRefresh}
          className="px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded text-sm"
          title="Refresh"
        >
          <RefreshCw size={16} />
        </button>
        {isWorkingChanges && hasChanges && (
          <button
            onClick={onReset}
            disabled={isResetting || isCommitting || isGenerating}
            className="px-2 py-1 text-text-tertiary hover:text-red-400 disabled:text-text-muted disabled:cursor-not-allowed text-sm transition-colors"
            title="Revert all changes"
          >
            {isResetting ? '...' : <Undo2 size={16} />}
          </button>
        )}
        {onExpand && (
          <button
            onClick={onExpand}
            className="px-1.5 py-0.5 text-sm bg-control-bg hover:bg-control-bg-hover rounded"
            title="Expand diff viewer"
          >
            <Maximize2 size={16} />
          </button>
        )}
      </div>
    </div>
  )
})

export default FileListHeader
