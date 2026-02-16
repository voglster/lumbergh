import { useState, useEffect, useCallback, memo } from 'react'
import '@git-diff-view/react/styles/diff-view.css'
import { FileList, FileDiff, CommitList, BranchSelector } from './diff'
import type { DiffData, Commit, CommitDiff } from './diff'

interface Props {
  apiHost: string
  sessionName?: string
  diffData?: DiffData | null
  onRefreshDiff?: () => void
  onCommitSuccess?: () => void
  onFocusTerminal?: () => void
}

interface RemoteStatus {
  branch?: string
  remote?: string
  ahead: number
  behind: number
  error?: string
}

type ViewState =
  | { level: 'history' }
  | { level: 'changes'; commit: string | null }
  | { level: 'file'; commit: string | null; file: string }

const DiffViewer = memo(function DiffViewer({
  apiHost,
  sessionName,
  diffData: externalDiffData,
  onRefreshDiff,
  onCommitSuccess,
  onFocusTerminal,
}: Props) {
  // Build base URL for git endpoints
  const gitBaseUrl = sessionName
    ? `http://${apiHost}/api/sessions/${sessionName}/git`
    : `http://${apiHost}/api/git`
  // Working changes data - use external data if provided, otherwise fetch internally
  const [internalWorkingData, setInternalWorkingData] = useState<DiffData | null>(null)
  const workingData = externalDiffData !== undefined ? externalDiffData : internalWorkingData
  // Commit history
  const [commits, setCommits] = useState<Commit[]>([])
  // Selected commit diff data
  const [commitData, setCommitData] = useState<CommitDiff | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Remote status for push button (when no changes)
  const [remoteStatus, setRemoteStatus] = useState<RemoteStatus | null>(null)
  const [isPushing, setIsPushing] = useState(false)

  // Navigation state - default to working changes view
  const [view, setView] = useState<ViewState>({ level: 'changes', commit: null })

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

  const fetchCommits = useCallback(async () => {
    const res = await fetch(`${gitBaseUrl}/log`)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const json = await res.json()
    setCommits(json.commits)
  }, [gitBaseUrl])

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
      }
    } catch {
      // ignore
    } finally {
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

  // Fetch remote status when there are no changes (for push button)
  const hasNoChanges = !workingData || workingData.files.length === 0
  useEffect(() => {
    if (hasNoChanges && view.level === 'changes' && !view.commit) {
      fetchRemoteStatus()
    }
  }, [hasNoChanges, view, fetchRemoteStatus])

  // Fetch history and working changes when viewing history
  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      // Fetch commits and refresh working changes
      await fetchCommits()
      await refreshWorkingChanges()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch history')
    } finally {
      setLoading(false)
    }
  }, [fetchCommits, refreshWorkingChanges])

  // Handle navigation
  const handleSelectCommit = (hash: string | null) => {
    setView({ level: 'changes', commit: hash })
  }

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

  const handleNavigateToHistory = () => {
    setView({ level: 'history' })
    loadHistory()
  }

  const handleRefresh = async () => {
    if (view.level === 'history') {
      await loadHistory()
    } else if (view.level === 'changes' && view.commit) {
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

  // Get current data based on view
  const getCurrentData = (): DiffData | null => {
    if (view.level === 'history') return null
    if (view.level === 'changes' || view.level === 'file') {
      if (view.commit) return commitData
    }
    return workingData
  }

  const getCurrentCommitInfo = () => {
    if (view.level === 'history') return null
    const commitHash = view.commit
    if (!commitHash) return null
    if (commitData && commitData.hash === commitHash) {
      return {
        hash: commitData.hash,
        shortHash: commitData.hash.slice(0, 7),
        message: commitData.message,
      }
    }
    const commit = commits.find((c) => c.hash === commitHash)
    if (commit) {
      return {
        hash: commit.hash,
        shortHash: commit.shortHash,
        message: commit.message,
      }
    }
    return null
  }

  // Loading state
  if (loading && view.level !== 'history') {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">Loading diff...</div>
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

  // History view
  if (view.level === 'history') {
    return (
      <CommitList
        commits={commits}
        workingChanges={workingData}
        loading={loading}
        onSelectCommit={handleSelectCommit}
        onRefresh={loadHistory}
      />
    )
  }

  const data = getCurrentData()

  // No data / empty state (only for working changes)
  // At this point view.level is 'changes' or 'file' (we returned early for 'history')
  const isWorkingChanges = view.level === 'changes' && !view.commit
  if (!data || data.files.length === 0) {
    if (isWorkingChanges) {
      return (
        <div className="h-full flex flex-col">
          {/* Breadcrumb header */}
          <div className="flex items-center justify-between p-3 bg-gray-800 border-b border-gray-700">
            <div className="flex items-center gap-2">
              <button
                onClick={handleNavigateToHistory}
                className="text-sm text-blue-400 hover:text-blue-300"
              >
                History
              </button>
              <span className="text-gray-500">›</span>
              <span className="text-sm text-gray-300">Working Changes</span>
              {sessionName && (
                <BranchSelector gitBaseUrl={gitBaseUrl} onBranchChange={handleRefresh} />
              )}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={handleRefresh}
                className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
              >
                ↻
              </button>
              {remoteStatus && remoteStatus.ahead > 0 && (
                <button
                  onClick={handlePush}
                  disabled={isPushing}
                  className="px-2 py-1 text-blue-400 hover:text-blue-300 disabled:text-gray-600 disabled:cursor-not-allowed text-sm transition-colors"
                  title={`Push ${remoteStatus.ahead} commit${remoteStatus.ahead > 1 ? 's' : ''} to ${remoteStatus.remote || 'remote'}`}
                >
                  {isPushing ? '...' : `↑${remoteStatus.ahead}`}
                </button>
              )}
            </div>
          </div>
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-500">
            <span>No changes detected</span>
          </div>
        </div>
      )
    }
    // Commit with no files - shouldn't happen but handle gracefully
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
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
          apiHost={apiHost}
          sessionName={sessionName}
          onFocusTerminal={onFocusTerminal}
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
      apiHost={apiHost}
      sessionName={sessionName}
      onSelectFile={handleSelectFile}
      onRefresh={handleRefresh}
      commit={getCurrentCommitInfo()}
      onNavigateToHistory={handleNavigateToHistory}
      onCommitSuccess={onCommitSuccess}
    />
  )
})

export default DiffViewer
