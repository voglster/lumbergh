import type { Commit, DiffData } from './types'

interface Props {
  commits: Commit[]
  workingChanges: DiffData | null
  loading: boolean
  onSelectCommit: (hash: string | null) => void
  onRefresh: () => void
}

export default function CommitList({
  commits,
  workingChanges,
  loading,
  onSelectCommit,
  onRefresh,
}: Props) {
  const hasWorkingChanges = workingChanges && workingChanges.files.length > 0

  return (
    <div className="h-full flex flex-col">
      {/* Header */}
      <div className="flex items-center justify-between p-3 bg-bg-surface border-b border-border-default">
        <span className="text-sm font-medium text-text-secondary">History</span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded text-sm disabled:opacity-50"
        >
          {loading ? '...' : '↻'}
        </button>
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-auto">
        {/* Working Changes entry */}
        <button
          onClick={() => onSelectCommit(null)}
          className={`w-full flex items-center gap-3 px-3 py-3 hover:bg-bg-surface border-b border-border-default/50 text-left ${
            hasWorkingChanges ? 'bg-bg-surface/50' : ''
          }`}
        >
          <span className="text-yellow-400 font-mono text-xs">●</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-text-primary truncate">Working Changes</div>
            {hasWorkingChanges ? (
              <div className="text-xs text-text-tertiary">
                {workingChanges.files.length} file{workingChanges.files.length !== 1 ? 's' : ''}{' '}
                <span className="text-green-400">+{workingChanges.stats.additions}</span>{' '}
                <span className="text-red-400">-{workingChanges.stats.deletions}</span>
              </div>
            ) : (
              <div className="text-xs text-text-muted">No uncommitted changes</div>
            )}
          </div>
          <span className="text-text-muted">›</span>
        </button>

        {/* Commit entries */}
        {commits.map((commit) => (
          <button
            key={commit.hash}
            onClick={() => onSelectCommit(commit.hash)}
            className="w-full flex items-center gap-3 px-3 py-3 hover:bg-bg-surface border-b border-border-default/50 text-left"
          >
            <span className="text-blue-400 font-mono text-xs">{commit.shortHash}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-text-secondary truncate">{commit.message}</div>
              <div className="text-xs text-text-muted">
                {commit.author} · {commit.relativeDate}
              </div>
            </div>
            <span className="text-text-muted">›</span>
          </button>
        ))}

        {commits.length === 0 && !loading && (
          <div className="p-4 text-center text-text-muted text-sm">No commits found</div>
        )}
      </div>
    </div>
  )
}
