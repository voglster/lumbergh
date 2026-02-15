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
      <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
        <span className="text-sm font-medium text-gray-300">History</span>
        <button
          onClick={onRefresh}
          disabled={loading}
          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm disabled:opacity-50"
        >
          {loading ? '...' : '↻'}
        </button>
      </div>

      {/* Commit list */}
      <div className="flex-1 overflow-auto">
        {/* Working Changes entry */}
        <button
          onClick={() => onSelectCommit(null)}
          className={`w-full flex items-center gap-3 px-3 py-3 hover:bg-gray-800 border-b border-gray-700/50 text-left ${
            hasWorkingChanges ? 'bg-gray-800/50' : ''
          }`}
        >
          <span className="text-yellow-400 font-mono text-xs">●</span>
          <div className="flex-1 min-w-0">
            <div className="text-sm font-medium text-white truncate">Working Changes</div>
            {hasWorkingChanges ? (
              <div className="text-xs text-gray-400">
                {workingChanges.files.length} file{workingChanges.files.length !== 1 ? 's' : ''}{' '}
                <span className="text-green-400">+{workingChanges.stats.additions}</span>{' '}
                <span className="text-red-400">-{workingChanges.stats.deletions}</span>
              </div>
            ) : (
              <div className="text-xs text-gray-500">No uncommitted changes</div>
            )}
          </div>
          <span className="text-gray-500">›</span>
        </button>

        {/* Commit entries */}
        {commits.map((commit) => (
          <button
            key={commit.hash}
            onClick={() => onSelectCommit(commit.hash)}
            className="w-full flex items-center gap-3 px-3 py-3 hover:bg-gray-800 border-b border-gray-700/50 text-left"
          >
            <span className="text-blue-400 font-mono text-xs">{commit.shortHash}</span>
            <div className="flex-1 min-w-0">
              <div className="text-sm text-gray-300 truncate">{commit.message}</div>
              <div className="text-xs text-gray-500">
                {commit.author} · {commit.relativeDate}
              </div>
            </div>
            <span className="text-gray-500">›</span>
          </button>
        ))}

        {commits.length === 0 && !loading && (
          <div className="p-4 text-center text-gray-500 text-sm">No commits found</div>
        )}
      </div>
    </div>
  )
}
