import { useState, useCallback } from 'react'
import VerticalResizablePanes from '../VerticalResizablePanes'
import GitGraph from './GitGraph'
import DiffViewer from '../DiffViewer'

interface DiffData {
  files: Array<{ path: string; diff: string }>
  stats: { additions: number; deletions: number }
}

interface Props {
  apiHost: string
  sessionName?: string
  diffData: DiffData | null
  onRefreshDiff: () => void
  onFocusTerminal?: () => void
  onJumpToTodos?: () => void
}

export default function GitTab({
  apiHost,
  sessionName,
  diffData,
  onRefreshDiff,
  onFocusTerminal,
  onJumpToTodos,
}: Props) {
  const [selectedCommit, setSelectedCommit] = useState<string | null>(null)
  const [graphRefreshTrigger, setGraphRefreshTrigger] = useState(0)

  const handleSelectCommit = useCallback((hash: string | null) => {
    setSelectedCommit(hash)
  }, [])

  const handleGitAction = useCallback(() => {
    setGraphRefreshTrigger((n) => n + 1)
  }, [])

  return (
    <VerticalResizablePanes
      top={
        <GitGraph
          apiHost={apiHost}
          sessionName={sessionName}
          onSelectCommit={handleSelectCommit}
          selectedCommit={selectedCommit}
          refreshTrigger={graphRefreshTrigger}
          onGitAction={handleGitAction}
        />
      }
      bottom={
        <DiffViewer
          apiHost={apiHost}
          sessionName={sessionName}
          diffData={diffData}
          onRefreshDiff={onRefreshDiff}
          onFocusTerminal={onFocusTerminal}
          onJumpToTodos={onJumpToTodos}
          selectedCommit={selectedCommit}
          onGitAction={handleGitAction}
        />
      }
      defaultTopHeight={40}
      minTopHeight={15}
      maxTopHeight={75}
      storageKey="lumbergh:gitTabSplitHeight"
    />
  )
}
