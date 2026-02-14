import { useState, useEffect, useCallback } from 'react'
import '@git-diff-view/react/styles/diff-view.css'
import { FileList, FileDiff, CommitList } from './diff'
import type { DiffData, Commit, CommitDiff } from './diff'

interface Props {
  apiHost: string
  onCommitSuccess?: () => void
}

type ViewState =
  | { level: 'history' }
  | { level: 'changes'; commit: string | null }
  | { level: 'file'; commit: string | null; file: string }

export default function DiffViewer({ apiHost, onCommitSuccess }: Props) {
  // Working changes data
  const [workingData, setWorkingData] = useState<DiffData | null>(null)
  // Commit history
  const [commits, setCommits] = useState<Commit[]>([])
  // Selected commit diff data
  const [commitData, setCommitData] = useState<CommitDiff | null>(null)

  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Navigation state - default to working changes view
  const [view, setView] = useState<ViewState>({ level: 'changes', commit: null })

  const fetchWorkingChanges = useCallback(async () => {
    try {
      const res = await fetch(`http://${apiHost}/api/git/diff`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setWorkingData(json)
    } catch (e) {
      throw e
    }
  }, [apiHost])

  const fetchCommits = useCallback(async () => {
    try {
      const res = await fetch(`http://${apiHost}/api/git/log`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setCommits(json.commits)
    } catch (e) {
      throw e
    }
  }, [apiHost])

  const fetchCommitDiff = useCallback(async (hash: string) => {
    try {
      const res = await fetch(`http://${apiHost}/api/git/commit/${hash}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setCommitData(json)
    } catch (e) {
      throw e
    }
  }, [apiHost])

  // Initial load - fetch working changes
  const loadInitialData = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await fetchWorkingChanges()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch diff')
    } finally {
      setLoading(false)
    }
  }, [fetchWorkingChanges])

  useEffect(() => {
    loadInitialData()
  }, [loadInitialData])

  // Fetch commit diff when viewing a specific commit
  useEffect(() => {
    if (view.level === 'changes' && view.commit) {
      setLoading(true)
      setError(null)
      fetchCommitDiff(view.commit)
        .catch(e => setError(e instanceof Error ? e.message : 'Failed to fetch commit'))
        .finally(() => setLoading(false))
    }
  }, [view, fetchCommitDiff])

  // Fetch history and working changes when viewing history
  const loadHistory = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      await Promise.all([fetchCommits(), fetchWorkingChanges()])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch history')
    } finally {
      setLoading(false)
    }
  }, [fetchCommits, fetchWorkingChanges])

  // Handle navigation
  const handleSelectCommit = (hash: string | null) => {
    setView({ level: 'changes', commit: hash })
  }

  const handleSelectFile = (file: string) => {
    setView(prev => {
      if (prev.level === 'changes') {
        return { level: 'file', commit: prev.commit, file }
      }
      return prev
    })
  }

  const handleBackToChanges = () => {
    setView(prev => {
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
      await loadInitialData()
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
    const commit = commits.find(c => c.hash === commitHash)
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
      <div className="flex items-center justify-center h-full text-gray-500">
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
          <div className="flex items-center gap-2 p-3 bg-gray-800 border-b border-gray-700">
            <button
              onClick={handleNavigateToHistory}
              className="text-sm text-blue-400 hover:text-blue-300"
            >
              History
            </button>
            <span className="text-gray-500">›</span>
            <span className="text-sm text-gray-300">Working Changes</span>
          </div>
          <div className="flex flex-col items-center justify-center flex-1 gap-4 text-gray-500">
            <span>No changes detected</span>
            <button
              onClick={handleRefresh}
              className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
            >
              Refresh
            </button>
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
    const file = data.files.find(f => f.path === view.file)
    if (file) {
      return <FileDiff file={file} onBack={handleBackToChanges} />
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
      onSelectFile={handleSelectFile}
      onRefresh={handleRefresh}
      commit={getCurrentCommitInfo()}
      onNavigateToHistory={handleNavigateToHistory}
      onCommitSuccess={onCommitSuccess}
    />
  )
}
