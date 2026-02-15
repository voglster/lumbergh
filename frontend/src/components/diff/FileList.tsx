import { useState } from 'react'
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
  onCommitSuccess?: () => void
}

export default function FileList({ data, apiHost, sessionName, onSelectFile, onRefresh, commit, onNavigateToHistory, onCommitSuccess }: Props) {
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [commitResult, setCommitResult] = useState<{ type: 'success' | 'error', message: string } | null>(null)

  // Build commit URL based on whether we have a session
  const commitUrl = sessionName
    ? `http://${apiHost}/api/sessions/${sessionName}/git/commit`
    : `http://${apiHost}/api/git/commit`

  // Build AI generate URL (only works with sessions)
  const generateUrl = sessionName
    ? `http://${apiHost}/api/sessions/${sessionName}/ai/generate-commit-message`
    : null

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
        onCommitSuccess?.()
      }
    } catch (err) {
      setCommitResult({ type: 'error', message: 'Failed to commit' })
    } finally {
      setIsCommitting(false)
      // Clear result message after 3 seconds
      setTimeout(() => setCommitResult(null), 3000)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && commitMessage.trim()) {
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
    } catch (err) {
      setCommitResult({ type: 'error', message: 'Failed to generate commit message' })
    } finally {
      setIsGenerating(false)
      setTimeout(() => setCommitResult(null), 3000)
    }
  }

  const isWorkingChanges = !commit
  const hasChanges = data.files.length > 0

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb header */}
      <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
        <div className="flex items-center gap-2 min-w-0 flex-1">
          {onNavigateToHistory && (
            <>
              <button
                onClick={onNavigateToHistory}
                className="text-sm text-blue-400 hover:text-blue-300 shrink-0"
              >
                History
              </button>
              <span className="text-gray-500 shrink-0">›</span>
            </>
          )}
          <span className="text-sm text-gray-300 truncate">
            {isWorkingChanges ? (
              'Working Changes'
            ) : (
              <>
                <span className="text-blue-400 font-mono">{commit.shortHash}</span>
                <span className="text-gray-500">: </span>
                <span className="text-gray-400">{commit.message}</span>
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
            className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
          >
            ↻
          </button>
        </div>
      </div>

      {/* Commit input - only show for working changes */}
      {isWorkingChanges && (
      <div className="p-3 bg-gray-800 border-b border-gray-700">
        <div className="flex gap-2">
          <input
            type="text"
            value={commitMessage}
            onChange={e => setCommitMessage(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Commit message... (Enter to commit)"
            className="flex-1 px-3 py-2 bg-gray-700 text-white text-sm rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            disabled={isCommitting || isGenerating}
          />
          {generateUrl && hasChanges && (
            <button
              onClick={handleGenerate}
              disabled={isGenerating || isCommitting}
              className="px-3 py-2 bg-purple-600 hover:bg-purple-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white text-sm rounded transition-colors shrink-0"
              title="Generate commit message with AI"
            >
              {isGenerating ? '...' : 'AI'}
            </button>
          )}
        </div>
        {commitResult && (
          <div className={`mt-2 text-sm ${commitResult.type === 'success' ? 'text-green-400' : 'text-red-400'}`}>
            {commitResult.message}
          </div>
        )}
      </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-auto">
        {data.files.map(file => {
          const stats = getFileStats(file.diff)
          return (
            <button
              key={file.path}
              onClick={() => onSelectFile(file.path)}
              className="w-full flex items-center gap-3 px-3 py-2 hover:bg-gray-800 border-b border-gray-700/50 text-left"
            >
              <span className="text-blue-400 font-mono text-sm truncate flex-1">
                {file.path}
              </span>
              <span className="text-green-400 text-xs">+{stats.additions}</span>
              <span className="text-red-400 text-xs">-{stats.deletions}</span>
              <span className="text-gray-500">›</span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
