import { useState, useEffect, useCallback, useRef, memo } from 'react'
import '@git-diff-view/react/styles/diff-view.css'
import {
  RefreshCw,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ArrowDown,
  ArrowDownUp,
  X,
  CloudDownload,
} from 'lucide-react'
import { getApiBase } from '../config'
import { FileList, FileDiff, BranchSelector } from './diff'
import type { DiffData, CommitDiff } from './diff'

interface Props {
  sessionName?: string
  diffData?: DiffData | null
  onRefreshDiff?: () => void
  onFocusTerminal?: () => void
  onJumpToTodos?: () => void
  /** Controlled by parent (GitTab). null = working changes, string = commit hash */
  selectedCommit?: string | null
  /** Increments on every commit click (even re-clicks) to reset file-level view */
  commitSelectVersion?: number
  /** Called after git actions (commit, push, pull, reset) to refresh siblings like the graph */
  onGitAction?: () => void
}

interface RemoteStatus {
  branch?: string
  remote?: string
  ahead: number
  behind: number
  error?: string
  httpAuthWarning?: string
  fetchFailed?: boolean
}

type ViewState =
  | { level: 'changes'; commit: string | null }
  | { level: 'file'; commit: string | null; file: string }

const DiffViewer = memo(function DiffViewer({
  sessionName,
  diffData: externalDiffData,
  onRefreshDiff,
  onFocusTerminal,
  onJumpToTodos,
  selectedCommit: controlledCommit,
  commitSelectVersion,
  onGitAction,
}: Props) {
  const [expanded, setExpanded] = useState(false)
  const expandedScrollRef = useRef<HTMLDivElement>(null)
  // Build base URL for git endpoints
  const gitBaseUrl = sessionName
    ? `${getApiBase()}/sessions/${sessionName}/git`
    : `${getApiBase()}/git`
  // Working changes data - use external data if provided, otherwise fetch internally
  const [internalWorkingData, setInternalWorkingData] = useState<DiffData | null>(null)
  const workingData = externalDiffData !== undefined ? externalDiffData : internalWorkingData
  // Selected commit diff data
  const [commitData, setCommitData] = useState<CommitDiff | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Remote status for push button (when no changes)
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null)
  const [isPushing, setIsPushing] = useState(false)
  const [isPulling, setIsPulling] = useState(false)

  // Navigation state — commit selection controlled by parent if provided
  const isControlled = controlledCommit !== undefined
  const activeCommit = isControlled ? controlledCommit : null
  const [view, setView] = useState<ViewState>({ level: 'changes', commit: activeCommit })

  // Sync view when parent changes selectedCommit (or re-clicks the same one)
  useEffect(() => {
    if (isControlled) {
      setView({ level: 'changes', commit: activeCommit })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isControlled, commitSelectVersion])

  // Internal fetch for working changes (used when no external data provided)
  const fetchWorkingChangesInternal = useCallback(async () => {
    const res = await fetch(`${gitBaseUrl}/diff`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    setInternalWorkingData(json)
  }, [gitBaseUrl])

  // Refresh working changes - use external callback if provided
  const refreshWorkingChanges = useCallback(async () => {
    if (onRefreshDiff) {
      onRefreshDiff()
    } else {
      await fetchWorkingChangesInternal()
    }
  }, [onRefreshDiff, fetchWorkingChangesInternal])

  const fetchCommitDiff = useCallback(
    async (hash: string) => {
      const res = await fetch(`${gitBaseUrl}/commit/${hash}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setCommitData(json)
    },
    [gitBaseUrl]
  )

  // Fetch remote status (for push button when no changes)
  const fetchRemoteStatus = useCallback(async () => {
    if (!sessionName) return
    try {
      const res = await fetch(`${gitBaseUrl}/remote-status`)
      const data = await res.json()
      setRemoteStatus(data)
    } catch {
      setRemoteStatus(null)
    }
  }, [gitBaseUrl, sessionName])

  // Handle push
  const handlePush = async () => {
    if (!sessionName) return
    setIsPushing(true)
    try {
      const res = await fetch(`${gitBaseUrl}/push`, { method: 'POST' })
      if (res.ok) {
        fetchRemoteStatus()
        onGitAction?.()
      } else {
        const data = await res.json()
        const errorMsg = data.detail || 'Push failed'

        // Non-fast-forward errors - refresh status to show diverged state
        if (errorMsg.includes('non-fast-forward') || errorMsg.includes('Pull first')) {
          fetchRemoteStatus()
        } else {
          alert(errorMsg)
        }
      }
    } catch {
      alert('Push failed: network error')
    } finally {
      setIsPushing(false)
    }
  }

  // Handle pull with rebase
  const handlePull = async () => {
    if (!sessionName) return
    setIsPulling(true)
    try {
      const res = await fetch(`${gitBaseUrl}/pull`, { method: 'POST' })
      if (!res.ok) {
        const data = await res.json()
        alert(data.detail || 'Pull failed')
      } else {
        const data = await res.json()
        if (data.stashConflict) {
          alert(data.message)
        }
        fetchRemoteStatus()
        refreshWorkingChanges()
        onGitAction?.()
      }
    } catch {
      alert('Pull failed: network error')
    } finally {
      setIsPulling(false)
    }
  }

  // Handle pull then push (for non-fast-forward recovery)
  const handlePullAndPush = async () => {
    setIsPulling(true)
    try {
      const pullRes = await fetch(`${gitBaseUrl}/pull`, { method: 'POST' })
      if (!pullRes.ok) {
        const data = await pullRes.json()
        alert(`Pull failed: ${data.detail || 'Unknown error'}`)
        return
      }

      const pullData = await pullRes.json()
      if (pullData.stashConflict) {
        alert(pullData.message)
        return
      }

      // Pull succeeded, retry push
      setIsPushing(true)
      const pushRes = await fetch(`${gitBaseUrl}/push`, { method: 'POST' })
      if (pushRes.ok) {
        fetchRemoteStatus()
        refreshWorkingChanges()
        onGitAction?.()
      } else {
        const data = await pushRes.json()
        alert(`Push failed after pull: ${data.detail || 'Unknown error'}`)
      }
    } catch {
      alert('Operation failed: network error')
    } finally {
      setIsPulling(false)
      setIsPushing(false)
    }
  }

  // Initial load - fetch working changes only if no external data provided
  const loadInitialData = useCallback(async () => {
    // If external data is being used, no need to fetch
    if (externalDiffData !== undefined) {
      setLoading(false)
      return
    }
    setLoading(true)
    setError(null)
    try {
      await fetchWorkingChangesInternal()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch diff')
    } finally {
      setLoading(false)
    }
  }, [externalDiffData, fetchWorkingChangesInternal])

  useEffect(() => {
    loadInitialData()
  }, [loadInitialData])

  // Fetch commit diff when viewing a specific commit
  useEffect(() => {
    if (view.level === 'changes' && view.commit) {
      setLoading(true)
      setError(null)
      fetchCommitDiff(view.commit)
        .catch((e) => setError(e instanceof Error ? e.message : 'Failed to fetch commit'))
        .finally(() => setLoading(false))
    }
  }, [view, fetchCommitDiff])

  // Fetch remote status whenever viewing working changes
  useEffect(() => {
    if (view.level === 'changes' && !view.commit) {
      fetchRemoteStatus()
    }
  }, [view, fetchRemoteStatus])

  // Handle navigation
  const handleSelectFile = (file: string) => {
    setView((prev) => {
      if (prev.level === 'changes') {
        return { level: 'file', commit: prev.commit, file }
      }
      return prev
    })
  }

  const handleBackToChanges = () => {
    setView((prev) => {
      if (prev.level === 'file') {
        return { level: 'changes', commit: prev.commit }
      }
      return prev
    })
  }

  const handleRefresh = async () => {
    if (view.level === 'changes' && view.commit) {
      setLoading(true)
      try {
        await fetchCommitDiff(view.commit)
      } finally {
        setLoading(false)
      }
    } else {
      // Refresh working changes
      await refreshWorkingChanges()
    }
  }

  // Escape key to close expanded modal + body scroll lock
  useEffect(() => {
    if (!expanded) return
    const prev = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setExpanded(false)
        return
      }
      if ((e.key === 'ArrowDown' || e.key === 'ArrowUp') && expandedScrollRef.current) {
        if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
        e.preventDefault()
        // Find the deepest scrollable element (child components have their own overflow-auto)
        const el = expandedScrollRef.current
        const scrollable = el.querySelector('.overflow-auto') as HTMLElement | null
        const target =
          scrollable && scrollable.scrollHeight > scrollable.clientHeight ? scrollable : el
        target.scrollBy({ top: e.key === 'ArrowDown' ? 160 : -160, behavior: 'smooth' })
      }
    }
    window.addEventListener('keydown', handleKey)
    return () => {
      document.body.style.overflow = prev
      window.removeEventListener('keydown', handleKey)
    }
  }, [expanded])

  // Arrow key file navigation (only when expanded + file view)
  useEffect(() => {
    if (!expanded || view.level !== 'file') return
    const data = view.commit ? commitData : workingData
    if (!data || data.files.length === 0) return

    const handleArrow = (e: KeyboardEvent) => {
      if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return
      // Don't capture if user is in an input/textarea
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return
      e.preventDefault()
      const idx = data.files.findIndex((f) => f.path === view.file)
      if (idx === -1) return
      const len = data.files.length
      const nextIdx = e.key === 'ArrowRight' ? (idx + 1) % len : (idx - 1 + len) % len
      setView({ level: 'file', commit: view.commit, file: data.files[nextIdx].path })
    }
    window.addEventListener('keydown', handleArrow)
    return () => window.removeEventListener('keydown', handleArrow)
  }, [expanded, view, commitData, workingData])

  // Get current data based on view
  const getCurrentData = (): DiffData | null => {
    if (view.commit) return commitData
    return workingData
  }

  const getCurrentCommitInfo = () => {
    const commitHash = view.commit
    if (!commitHash) return null
    if (commitData && commitData.hash === commitHash) {
      return {
        hash: commitData.hash,
        shortHash: commitData.hash.slice(0, 7),
        message: commitData.message,
        author: commitData.author,
        relativeDate: commitData.relativeDate,
      }
    }
    return null
  }

  const handleSendToTerminal = useCallback(
    async (text: string, sendEnter: boolean) => {
      if (!sessionName) return
      try {
        await fetch(`${getApiBase()}/session/${sessionName}/send`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text, send_enter: sendEnter }),
        })
        onFocusTerminal?.()
      } catch (err) {
        console.error('Failed to send to terminal:', err)
      }
    },
    [sessionName, onFocusTerminal]
  )

  // Helper: file navigation for expanded mode
  const getFileNav = () => {
    if (view.level !== 'file') return null
    const data = getCurrentData()
    if (!data || data.files.length <= 1) return null
    const idx = data.files.findIndex((f) => f.path === view.file)
    if (idx === -1) return null
    const len = data.files.length
    return {
      index: idx,
      total: len,
      goPrev: () => {
        const prevIdx = (idx - 1 + len) % len
        setView({ level: 'file', commit: view.commit, file: data.files[prevIdx].path })
      },
      goNext: () => {
        const nextIdx = (idx + 1) % len
        setView({ level: 'file', commit: view.commit, file: data.files[nextIdx].path })
      },
    }
  }

  const handleExpand = expanded ? undefined : () => setExpanded(true)

  // Build content based on current state
  const renderContent = () => {
    // Loading state
    if (loading) {
      return (
        <div className="flex items-center justify-center h-full text-text-muted">
          Loading diff...
        </div>
      )
    }

    // Error state
    if (error) {
      return (
        <div className="flex flex-col items-center justify-center h-full gap-4">
          <span className="text-red-400">Error: {error}</span>
          <button
            onClick={handleRefresh}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white"
          >
            Retry
          </button>
        </div>
      )
    }

    const data = getCurrentData()

    // No data / empty state (only for working changes)
    const isWorkingChanges = view.level === 'changes' && !view.commit
    if (!data || data.files.length === 0) {
      if (isWorkingChanges) {
        return (
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="flex items-center justify-between p-3 bg-bg-surface border-b border-border-default">
              <div className="flex items-center gap-2">
                <span className="text-sm text-text-secondary">Working Changes</span>
                {sessionName && (
                  <BranchSelector gitBaseUrl={gitBaseUrl} onBranchChange={handleRefresh} />
                )}
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={fetchRemoteStatus}
                  className="px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded text-sm transition-colors"
                  title="Fetch from remote"
                >
                  <CloudDownload size={16} />
                </button>
                <button
                  onClick={handleRefresh}
                  className="px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded text-sm"
                >
                  <RefreshCw size={16} />
                </button>
              </div>
            </div>
            <div className="flex flex-col items-center justify-center flex-1 gap-6 p-6">
              {remoteStatus?.httpAuthWarning && (
                <div className="w-full max-w-md rounded bg-yellow-900/40 border border-yellow-600/50 px-4 py-3 text-sm text-yellow-300">
                  {remoteStatus.httpAuthWarning}
                </div>
              )}
              {remoteStatus && remoteStatus.ahead > 0 && remoteStatus.behind > 0 ? (
                // Diverged state - need to pull before push
                <>
                  <div className="text-center">
                    <div className="text-lg text-yellow-400 mb-1">Branches have diverged</div>
                    <div className="text-text-muted">
                      {remoteStatus.ahead} unpushed commit{remoteStatus.ahead > 1 ? 's' : ''},{' '}
                      {remoteStatus.behind} commit{remoteStatus.behind > 1 ? 's' : ''} behind{' '}
                      <span className="font-mono">{remoteStatus.remote || 'origin'}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={handlePullAndPush}
                      disabled={isPulling || isPushing}
                      className="px-6 py-3 bg-yellow-600 hover:bg-yellow-500 disabled:bg-control-bg-hover disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isPulling ? (
                        <>Pulling...</>
                      ) : isPushing ? (
                        <>Pushing...</>
                      ) : (
                        <>
                          <ArrowDownUp size={18} />
                          <span>Pull (rebase) & Push</span>
                        </>
                      )}
                    </button>
                    {onJumpToTodos && (
                      <button
                        onClick={onJumpToTodos}
                        className="px-4 py-2 text-text-tertiary hover:text-text-secondary text-sm transition-colors"
                      >
                        Something else to work on? Jump to Todos →
                      </button>
                    )}
                  </div>
                </>
              ) : remoteStatus && remoteStatus.ahead > 0 ? (
                <>
                  <div className="text-center">
                    <div className="text-lg text-text-secondary mb-1">No local changes</div>
                    <div className="text-text-muted">
                      You have {remoteStatus.ahead} unpushed commit
                      {remoteStatus.ahead > 1 ? 's' : ''} on{' '}
                      <span className="text-blue-400 font-mono">{remoteStatus.branch}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={handlePush}
                      disabled={isPushing}
                      className="px-6 py-3 bg-blue-600 hover:bg-blue-500 disabled:bg-control-bg-hover disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isPushing ? (
                        <>Pushing...</>
                      ) : (
                        <>
                          <ArrowUp size={18} />
                          <span>Push to {remoteStatus.remote || 'origin'}</span>
                        </>
                      )}
                    </button>
                    {onJumpToTodos && (
                      <button
                        onClick={onJumpToTodos}
                        className="px-4 py-2 text-text-tertiary hover:text-text-secondary text-sm transition-colors"
                      >
                        Something else to work on? Jump to Todos →
                      </button>
                    )}
                  </div>
                </>
              ) : remoteStatus && remoteStatus.behind > 0 ? (
                <>
                  <div className="text-center">
                    <div className="text-lg text-text-secondary mb-1">No local changes</div>
                    <div className="text-yellow-500">
                      {remoteStatus.behind} commit{remoteStatus.behind > 1 ? 's' : ''} behind{' '}
                      <span className="font-mono">{remoteStatus.remote || 'origin'}</span>
                    </div>
                  </div>
                  <div className="flex flex-col gap-3">
                    <button
                      onClick={handlePull}
                      disabled={isPulling}
                      className="px-6 py-3 bg-yellow-600 hover:bg-yellow-500 disabled:bg-control-bg-hover disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center justify-center gap-2"
                    >
                      {isPulling ? (
                        <>Pulling...</>
                      ) : (
                        <>
                          <ArrowDown size={18} />
                          <span>Pull from {remoteStatus.remote || 'origin'}</span>
                        </>
                      )}
                    </button>
                    {onJumpToTodos && (
                      <button
                        onClick={onJumpToTodos}
                        className="px-4 py-2 text-text-tertiary hover:text-text-secondary text-sm transition-colors"
                      >
                        Something else to work on? Jump to Todos →
                      </button>
                    )}
                  </div>
                </>
              ) : remoteStatus ? (
                <>
                  <div className="text-center">
                    <div className="text-lg text-text-secondary mb-1">All caught up</div>
                    <div className="text-text-muted">
                      No local changes, in sync with{' '}
                      <span className="font-mono">{remoteStatus.remote || 'origin'}</span>
                    </div>
                  </div>
                  {onJumpToTodos && (
                    <button
                      onClick={onJumpToTodos}
                      className="px-4 py-2 text-text-tertiary hover:text-text-secondary text-sm transition-colors"
                    >
                      Something else to work on? Jump to Todos →
                    </button>
                  )}
                </>
              ) : (
                <div className="text-text-muted">No changes detected</div>
              )}
            </div>
          </div>
        )
      }
      // Commit with no files - shouldn't happen but handle gracefully
      return (
        <div className="flex items-center justify-center h-full text-text-muted">
          No files in this commit
        </div>
      )
    }

    // Single file diff view
    if (view.level === 'file') {
      const file = data.files.find((f) => f.path === view.file)
      if (file) {
        return (
          <FileDiff
            file={file}
            onBack={handleBackToChanges}
            sessionName={sessionName}
            onFocusTerminal={onFocusTerminal}
            onCloseExpanded={expanded ? () => setExpanded(false) : undefined}
            onExpand={handleExpand}
          />
        )
      }
      // File not found, go back to changes
      handleBackToChanges()
      return null
    }

    // File list view (changes level)
    return (
      <FileList
        data={data}
        sessionName={sessionName}
        onSelectFile={handleSelectFile}
        onRefresh={handleRefresh}
        commit={getCurrentCommitInfo()}
        onSendToTerminal={sessionName ? handleSendToTerminal : undefined}
        onGitAction={onGitAction}
        onExpand={handleExpand}
        remoteStatus={remoteStatus}
        onFetch={fetchRemoteStatus}
        onPull={handlePull}
        isPulling={isPulling}
      />
    )
  }

  // Expanded fullscreen modal
  if (expanded) {
    const fileNav = getFileNav()
    return (
      <div className="fixed inset-0 bg-black/95 flex flex-col z-50">
        {/* Header bar */}
        <div className="flex items-center justify-between px-3 py-2 bg-bg-sunken border-b border-border-default">
          <span className="text-sm text-text-secondary">Diff Viewer</span>
          {fileNav && (
            <div className="flex items-center gap-2">
              <button
                onClick={fileNav.goPrev}
                className="px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded text-sm"
                title="Previous file (←)"
              >
                <ArrowLeft size={16} />
              </button>
              <span className="text-xs text-text-muted tabular-nums">
                {fileNav.index + 1} / {fileNav.total}
              </span>
              <button
                onClick={fileNav.goNext}
                className="px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded text-sm"
                title="Next file (→)"
              >
                <ArrowRight size={16} />
              </button>
            </div>
          )}
          <button
            onClick={() => setExpanded(false)}
            className="px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded text-sm"
            title="Close (Escape)"
          >
            <X size={16} className="inline mr-1" />
            Close
          </button>
        </div>
        {/* Content */}
        <div className="flex-1 min-h-0 overflow-auto" ref={expandedScrollRef}>
          {renderContent()}
        </div>
      </div>
    )
  }

  // Inline (non-expanded) mode
  return renderContent()
})

export default DiffViewer
