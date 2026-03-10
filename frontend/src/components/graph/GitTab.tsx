import { useState, useCallback } from 'react'
import VerticalResizablePanes from '../VerticalResizablePanes'
import GitGraph from './GitGraph'
import DiffViewer from '../DiffViewer'

interface DiffData {
  files: Array<{ path: string; diff: string }>
  stats: { additions: number; deletions: number }
}

interface Props {
  sessionName?: string
  diffData: DiffData | null
  onRefreshDiff: () => void
  onFocusTerminal?: () => void
  onJumpToTodos?: () => void
  resetTrigger?: number
}

export default function GitTab({
  sessionName,
  diffData,
  onRefreshDiff,
  onFocusTerminal,
  onJumpToTodos,
  resetTrigger,
}: Props) {
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [graphRefreshTrigger, setGraphRefreshTrigger] = useState(0)

  const [commitSelectVersion, setCommitSelectVersion] = useState(0)

  const handleSelectCommit = useCallback((hash: string | null) => {
    setSelectedCommit(hash)
    setCommitSelectVersion((n) => n + 1)
  }, [])

  const handleGitAction = useCallback(() => {
    setGraphRefreshTrigger((n) => n + 1)
  }, [])

  return (
    <VerticalResizablePanes
      top={
        <GitGraph
          sessionName={sessionName}
          onSelectCommit={handleSelectCommit}
          selectedCommit={selectedCommit}
          refreshTrigger={graphRefreshTrigger}
          resetTrigger={resetTrigger}
          onGitAction={handleGitAction}
        />
      }
      bottom={
        <DiffViewer
          sessionName={sessionName}
          diffData={diffData}
          onRefreshDiff={onRefreshDiff}
          onFocusTerminal={onFocusTerminal}
          onJumpToTodos={onJumpToTodos}
          selectedCommit={selectedCommit}
          commitSelectVersion={commitSelectVersion}
          onGitAction={handleGitAction}
        />
      }
      defaultTopHeight={40}
      minTopHeight={15}
      maxTopHeight={75}
      storageKey={
        sessionName ? `lumbergh:gitTabSplitHeight:${sessionName}` : 'lumbergh:gitTabSplitHeight'
      }
    />
  )
}
