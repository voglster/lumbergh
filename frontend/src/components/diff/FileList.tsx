import { useState, memo } from 'react'
import type { DiffData } from './types'
import { getFileStats } from './utils'
import BranchSelector from './BranchSelector'

interface Props {
  data: DiffData
  apiHost: string
  sessionName?: string
  onSelectFile: (path: string) => void
  onRefresh: () => void
  commit?: { hash: string; shortHash: string; message: string } | null
  onNavigateToHistory?: () => void
}

const FileList = memo(function FileList({
  data,
  apiHost,
  sessionName,
  onSelectFile,
  onRefresh,
  commit,
  onNavigateToHistory,
}: Props) {
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [commitResult, setCommitResult] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  // Build commit URL based on whether we have a session
  const commitUrl = sessionName
    ? `http://${apiHost}/api/sessions/${sessionName}/git/commit`
    : `http://${apiHost}/api/git/commit`

  // Build AI generate URL (only works with sessions)
  const generateUrl = sessionName
    ? `http://${apiHost}/api/sessions/${sessionName}/ai/generate-commit-message`
    : null

  // Build reset URL
  const resetUrl = sessionName
    ? `http://${apiHost}/api/sessions/${sessionName}/git/reset`
    : `http://${apiHost}/api/git/reset`

  const isWorkingChanges = !commit
  const hasChanges = data.files.length > 0

  const handleReset = async () => {
    if (
      !confirm(
        'Revert all changes? This will discard all uncommitted changes and cannot be undone.'
      )
    ) {
      return
    }
    setIsResetting(true)
    setCommitResult(null)
    try {
      const res = await fetch(resetUrl, { method: 'POST' })
      const result = await res.json()
      if (!res.ok) {
        setCommitResult({ type: 'error', message: result.detail || 'Reset failed' })
      } else if (result.status === 'nothing_to_reset') {
        setCommitResult({ type: 'error', message: 'Nothing to reset' })
      } else {
        setCommitResult({ type: 'success', message: 'All changes reverted' })
        onRefresh()
      }
    } catch {
      setCommitResult({ type: 'error', message: 'Failed to reset changes' })
    } finally {
      setIsResetting(false)
      setTimeout(() => setCommitResult(null), 3000)
    }
  }

  const handleCommit = async () => {
    if (!commitMessage.trim()) return
    setIsCommitting(true)
    setCommitResult(null)
    try {
      const res = await fetch(commitUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ message: commitMessage.trim() }),
      })
      const result = await res.json()
      if (!res.ok) {
        setCommitResult({ type: 'error', message: result.detail || 'Commit failed' })
      } else if (result.status === 'nothing_to_commit') {
        setCommitResult({ type: 'error', message: 'Nothing to commit' })
      } else {
        setCommitResult({ type: 'success', message: `Committed: ${result.hash}` })
        setCommitMessage('')
        onRefresh()
      }
    } catch {
      setCommitResult({ type: 'error', message: 'Failed to commit' })
    } finally {
      setIsCommitting(false)
      // Clear result message after 3 seconds
      setTimeout(() => setCommitResult(null), 3000)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Cmd/Ctrl+Enter to commit
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && commitMessage.trim()) {
      e.preventDefault()
      handleCommit()
    }
  }

  const handleGenerate = async () => {
    if (!generateUrl) return
    setIsGenerating(true)
    setCommitResult(null)
    try {
      const res = await fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const result = await res.json()
      if (!res.ok) {
        setCommitResult({ type: 'error', message: result.detail || 'Failed to generate' })
      } else {
        setCommitMessage(result.message)
      }
    } catch {
      setCommitResult({ type: 'error', message: 'Failed to generate commit message' })
    } finally {
      setIsGenerating(false)
      setTimeout(() => setCommitResult(null), 3000)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb header */}
      <div className="flex items-center justify-between p-3 bg-bg-surface border-b border-border-default">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {onNavigateToHistory && (
            <>
              <button
                onClick={onNavigateToHistory}
                className="text-sm text-blue-400 hover:text-blue-300 shrink-0"
              >
                History
              </button>
              <span className="text-text-muted shrink-0">›</span>
            </>
          )}
          <span className="text-sm text-text-secondary truncate">
            {isWorkingChanges ? (
              'Working Changes'
            ) : (
              <>
                <span className="text-blue-400 font-mono">{commit.shortHash}</span>
                <span className="text-text-muted">: </span>
                <span className="text-text-tertiary">{commit.message}</span>
              </>
            )}
          </span>
          {isWorkingChanges && sessionName && (
            <BranchSelector
              gitBaseUrl={`http://${apiHost}/api/sessions/${sessionName}/git`}
              onBranchChange={onRefresh}
            />
          )}
        </div>
        <div className="flex items-center gap-3 shrink-0 ml-2">
          <span className="text-green-400 text-sm">+{data.stats.additions}</span>
          <span className="text-red-400 text-sm">-{data.stats.deletions}</span>
          <button
            onClick={onRefresh}
            className="px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded text-sm"
            title="Refresh"
          >
            ↻
          </button>
          {isWorkingChanges && hasChanges && (
            <button
              onClick={handleReset}
              disabled={isResetting || isCommitting || isGenerating}
              className="px-2 py-1 text-text-tertiary hover:text-red-400 disabled:text-text-muted disabled:cursor-not-allowed text-sm transition-colors"
              title="Revert all changes"
            >
              {isResetting ? '...' : '⟲'}
            </button>
          )}
        </div>
      </div>

      {/* Commit input - only show for working changes */}
      {isWorkingChanges && (
        <div className="p-3 bg-bg-surface border-b border-border-default">
          <div className="flex gap-2">
            <textarea
              value={commitMessage}
              onChange={(e) => setCommitMessage(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Commit message..."
              rows={commitMessage.includes('\n') ? 3 : 1}
              className="flex-1 px-3 py-2 bg-control-bg text-text-primary text-sm rounded border border-border-subtle focus:outline-none focus:border-blue-500 resize-none"
              disabled={isCommitting || isGenerating}
            />
            <div className="flex flex-col gap-2 shrink-0">
              <button
                onClick={handleCommit}
                disabled={!commitMessage.trim() || isCommitting || isGenerating || isResetting}
                className="px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-control-bg-hover disabled:cursor-not-allowed text-text-primary text-sm rounded transition-colors"
                title="Commit changes (Ctrl/Cmd+Enter)"
              >
                {isCommitting ? '...' : 'Commit'}
              </button>
              {generateUrl && hasChanges && (
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || isCommitting || isResetting}
                  className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-control-bg-hover disabled:cursor-not-allowed text-text-primary text-sm rounded transition-colors"
                  title="Generate commit message with AI"
                >
                  {isGenerating ? '...' : 'AI'}
                </button>
              )}
            </div>
          </div>
          {commitResult && (
            <div
              className={`mt-2 text-sm ${commitResult.type === 'success' ? 'text-green-400' : 'text-red-400'}`}
            >
              {commitResult.message}
            </div>
          )}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {data.files.map((file) => {
          const stats = getFileStats(file.diff)
          return (
            <button
              key={file.path}
              onClick={() => onSelectFile(file.path)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-bg-surface border-b border-border-default/50 text-left"
            >
              <span className="text-blue-400 font-mono text-sm truncate flex-1">{file.path}</span>
              <span className="text-green-400 text-xs">+{stats.additions}</span>
              <span className="text-red-400 text-xs">-{stats.deletions}</span>
              <span className="text-text-muted">›</span>
            </button>
          )
        })}
      </div>
    </div>
  )
})

export default FileList
