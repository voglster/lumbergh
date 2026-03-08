import { useState, useEffect, useRef, memo } from 'react'
import { Play, RefreshCw, Undo2, ChevronRight, MoreHorizontal, Maximize2 } from 'lucide-react'
import { getApiBase } from '../../config'
import { relativeDate } from '../../utils/relativeDate'
import type { DiffData } from './types'
import { getFileStats } from './utils'
import BranchSelector from './BranchSelector'

interface Props {
  data: DiffData
  sessionName?: string
  onSelectFile: (path: string) => void
  onRefresh: () => void
  commit?: { hash: string; shortHash: string; message: string; author?: string; relativeDate?: string } | null
  onSendToTerminal?: (text: string, sendEnter: boolean) => void
  onGitAction?: () => void
  onExpand?: () => void
}

const FileList = memo(function FileList({
  data,
  sessionName,
  onSelectFile,
  onRefresh,
  commit,
  onSendToTerminal,
  onGitAction,
  onExpand,
}: Props) {
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [showMenu, setShowMenu] = useState(false)
  const [copiedSha, setCopiedSha] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const [commitResult, setCommitResult] = useState<{
    type: 'success' | 'error'
    message: string
  } | null>(null)

  // Close menu on click outside
  useEffect(() => {
    if (!showMenu) return
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current && !menuRef.current.contains(e.target as Node) &&
        menuBtnRef.current && !menuBtnRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showMenu])

  const gitBaseUrl = sessionName
    ? `${getApiBase()}/sessions/${sessionName}/git`
    : `${getApiBase()}/git`

  const commitUrl = `${gitBaseUrl}/commit`
  const pushUrl = `${gitBaseUrl}/push`
  const resetUrl = `${gitBaseUrl}/reset`

  // Build AI generate URL (only works with sessions)
  const generateUrl = sessionName
    ? `${getApiBase()}/sessions/${sessionName}/ai/generate-commit-message`
    : null

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
        onGitAction?.()
      }
    } catch {
      setCommitResult({ type: 'error', message: 'Failed to reset changes' })
    } finally {
      setIsResetting(false)
      setTimeout(() => setCommitResult(null), 3000)
    }
  }

  const handleCommit = async (andPush = false) => {
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
        return
      }
      if (result.status === 'nothing_to_commit') {
        setCommitResult({ type: 'error', message: 'Nothing to commit' })
        return
      }

      setCommitMessage('')
      onRefresh()
      onGitAction?.()

      if (andPush) {
        setIsPushing(true)
        setCommitResult({ type: 'success', message: `Committed: ${result.hash} — pushing...` })
        try {
          const pushRes = await fetch(pushUrl, { method: 'POST' })
          if (pushRes.ok) {
            setCommitResult({ type: 'success', message: `Committed & pushed: ${result.hash}` })
            onGitAction?.()
          } else {
            const pushData = await pushRes.json()
            setCommitResult({ type: 'error', message: `Committed but push failed: ${pushData.detail || 'Unknown error'}` })
          }
        } catch {
          setCommitResult({ type: 'error', message: `Committed but push failed: network error` })
        } finally {
          setIsPushing(false)
        }
      } else {
        setCommitResult({ type: 'success', message: `Committed: ${result.hash}` })
      }
    } catch {
      setCommitResult({ type: 'error', message: 'Failed to commit' })
    } finally {
      setIsCommitting(false)
      setTimeout(() => setCommitResult(null), 4000)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!commitMessage.trim()) return
    // Cmd/Ctrl+Shift+Enter = commit & push
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault()
      handleCommit(true)
    // Cmd/Ctrl+Enter = commit only
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      handleCommit(false)
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

  const handleMenuAction = async (action: 'amend' | 'force-push' | 'stash' | 'stash-pop') => {
    setShowMenu(false)

    if (action === 'force-push') {
      if (!confirm('Force push with --force-with-lease? This will overwrite remote history.')) return
    }

    setCommitResult(null)

    try {
      const url = `${gitBaseUrl}/${action}`
      const options: RequestInit = { method: 'POST' }

      if (action === 'amend') {
        options.headers = { 'Content-Type': 'application/json' }
        options.body = JSON.stringify({
          message: commitMessage.trim() || null,
        })
      }

      const res = await fetch(url, options)
      const result = await res.json()

      if (!res.ok) {
        setCommitResult({ type: 'error', message: result.detail || `${action} failed` })
      } else {
        const messages: Record<string, string> = {
          amend: `Amended: ${result.hash} — ${result.message}`,
          'force-push': result.message || 'Force pushed',
          stash: 'Changes stashed',
          'stash-pop': 'Stash popped',
        }
        setCommitResult({ type: 'success', message: messages[action] })
        if (action === 'amend') setCommitMessage('')
        onRefresh()
        onGitAction?.()
      }
    } catch {
      setCommitResult({ type: 'error', message: `${action} failed` })
    } finally {
      setTimeout(() => setCommitResult(null), 4000)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb header */}
      <div className="flex items-center justify-between p-3 bg-bg-surface border-b border-border-default">
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-secondary truncate">
              {isWorkingChanges ? (
                'Working Changes'
              ) : (
                <>
                  <span
                    className="text-blue-400 font-mono cursor-pointer hover:underline"
                    title="Click to copy SHA"
                    onClick={(e) => {
                      e.stopPropagation()
                      navigator.clipboard.writeText(commit.hash)
                      setCopiedSha(true)
                      setTimeout(() => setCopiedSha(false), 1500)
                    }}
                  >{commit.shortHash}</span>
                  {copiedSha && (
                    <span className="ml-1 text-xs text-green-400">Copied!</span>
                  )}
                  <span className="text-text-muted">: </span>
                  <span className="text-text-tertiary">{commit.message}</span>
                </>
              )}
            </span>
          {!isWorkingChanges && commit && onSendToTerminal && (
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
          {isWorkingChanges && sessionName && (
            <BranchSelector
              gitBaseUrl={gitBaseUrl}
              onBranchChange={onRefresh}
            />
          )}
          </div>
          {!isWorkingChanges && commit?.author && (
            <div className="text-xs text-text-muted mt-0.5">
              {commit.author}{commit.relativeDate ? ` · ${relativeDate(commit.relativeDate)}` : ''}
            </div>
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
            <RefreshCw size={16} />
          </button>
          {isWorkingChanges && hasChanges && (
            <button
              onClick={handleReset}
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
            <div className="flex flex-col gap-1.5 shrink-0">
              <button
                onClick={() => handleCommit(true)}
                disabled={!commitMessage.trim() || isCommitting || isPushing || isGenerating || isResetting}
                className="px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-control-bg-hover disabled:cursor-not-allowed text-text-primary text-sm rounded transition-colors"
                title="Commit & push (Ctrl/Cmd+Shift+Enter)"
              >
                {isCommitting ? 'Committing...' : isPushing ? 'Pushing...' : 'Commit & Push'}
              </button>
              <div className="relative flex gap-1">
                <button
                  onClick={() => handleCommit(false)}
                  disabled={!commitMessage.trim() || isCommitting || isPushing || isGenerating || isResetting}
                  className="flex-1 px-2 py-1 text-text-tertiary hover:text-text-secondary disabled:text-text-muted disabled:cursor-not-allowed text-xs transition-colors"
                  title="Commit only (Ctrl/Cmd+Enter)"
                >
                  Commit
                </button>
                <button
                  ref={menuBtnRef}
                  onClick={() => setShowMenu((v) => !v)}
                  disabled={isCommitting || isPushing || isResetting}
                  className="px-1.5 py-1 text-text-tertiary hover:text-text-secondary disabled:text-text-muted disabled:cursor-not-allowed text-xs transition-colors"
                  title="More git actions"
                >
                  <MoreHorizontal size={16} />
                </button>
                {showMenu && (
                  <div
                    ref={menuRef}
                    className="absolute top-full right-0 mt-1 w-48 bg-bg-surface border border-border-default rounded shadow-lg z-50"
                  >
                    <button
                      onClick={() => handleMenuAction('amend')}
                      className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-control-bg-hover transition-colors"
                    >
                      Amend last commit
                    </button>
                    <button
                      onClick={() => handleMenuAction('force-push')}
                      className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-control-bg-hover transition-colors"
                    >
                      Force push (lease)
                    </button>
                    <div className="border-t border-border-default" />
                    <button
                      onClick={() => handleMenuAction('stash')}
                      className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-control-bg-hover transition-colors"
                    >
                      Stash changes
                    </button>
                    <button
                      onClick={() => handleMenuAction('stash-pop')}
                      className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-control-bg-hover transition-colors"
                    >
                      Pop stash
                    </button>
                  </div>
                )}
              </div>
              {generateUrl && hasChanges && (
                <button
                  onClick={handleGenerate}
                  disabled={isGenerating || isCommitting || isPushing || isResetting}
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
              <ChevronRight size={14} className="text-text-muted" />
            </button>
          )
        })}
      </div>
    </div>
  )
})

export default FileList
