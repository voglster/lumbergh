import { ArrowUp, ArrowDown, ArrowDownUp } from 'lucide-react'

interface RemoteStatus {
  branch?: string
  remote?: string
  ahead: number
  behind: number
  error?: string
  httpAuthWarning?: string
  fetchFailed?: boolean
}

interface Props {
  remoteStatus: RemoteStatus | null
  isPushing: boolean
  isPulling: boolean
  onPush: () => void
  onPull: () => void
  onPullAndPush: () => void
  onJumpToTodos?: () => void
}

function JumpToTodosButton({ onJumpToTodos }: { onJumpToTodos?: () => void }) {
  if (!onJumpToTodos) return null
  return (
    <button
      onClick={onJumpToTodos}
      className="px-4 py-2 text-text-tertiary hover:text-text-secondary text-sm transition-colors"
    >
      Something else to work on? Jump to Todos →
    </button>
  )
}

function DivergedView({
  remoteStatus,
  isPulling,
  isPushing,
  onPullAndPush,
  onJumpToTodos,
}: {
  remoteStatus: RemoteStatus
  isPulling: boolean
  isPushing: boolean
  onPullAndPush: () => void
  onJumpToTodos?: () => void
}) {
  return (
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
          onClick={onPullAndPush}
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
        <JumpToTodosButton onJumpToTodos={onJumpToTodos} />
      </div>
    </>
  )
}

function AheadView({
  remoteStatus,
  isPushing,
  onPush,
  onJumpToTodos,
}: {
  remoteStatus: RemoteStatus
  isPushing: boolean
  onPush: () => void
  onJumpToTodos?: () => void
}) {
  return (
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
          onClick={onPush}
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
        <JumpToTodosButton onJumpToTodos={onJumpToTodos} />
      </div>
    </>
  )
}

function BehindView({
  remoteStatus,
  isPulling,
  onPull,
  onJumpToTodos,
}: {
  remoteStatus: RemoteStatus
  isPulling: boolean
  onPull: () => void
  onJumpToTodos?: () => void
}) {
  return (
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
          onClick={onPull}
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
        <JumpToTodosButton onJumpToTodos={onJumpToTodos} />
      </div>
    </>
  )
}

function InSyncView({
  remoteStatus,
  onJumpToTodos,
}: {
  remoteStatus: RemoteStatus
  onJumpToTodos?: () => void
}) {
  return (
    <>
      <div className="text-center">
        <div className="text-lg text-text-secondary mb-1">All caught up</div>
        <div className="text-text-muted">
          No local changes, in sync with{' '}
          <span className="font-mono">{remoteStatus.remote || 'origin'}</span>
        </div>
      </div>
      <JumpToTodosButton onJumpToTodos={onJumpToTodos} />
    </>
  )
}

export default function RemoteStatusView({
  remoteStatus,
  isPushing,
  isPulling,
  onPush,
  onPull,
  onPullAndPush,
  onJumpToTodos,
}: Props) {
  if (!remoteStatus) {
    return <div className="text-text-muted">No changes detected</div>
  }

  if (remoteStatus.ahead > 0 && remoteStatus.behind > 0) {
    return (
      <DivergedView
        remoteStatus={remoteStatus}
        isPulling={isPulling}
        isPushing={isPushing}
        onPullAndPush={onPullAndPush}
        onJumpToTodos={onJumpToTodos}
      />
    )
  }

  if (remoteStatus.ahead > 0) {
    return (
      <AheadView
        remoteStatus={remoteStatus}
        isPushing={isPushing}
        onPush={onPush}
        onJumpToTodos={onJumpToTodos}
      />
    )
  }

  if (remoteStatus.behind > 0) {
    return (
      <BehindView
        remoteStatus={remoteStatus}
        isPulling={isPulling}
        onPull={onPull}
        onJumpToTodos={onJumpToTodos}
      />
    )
  }

  return <InSyncView remoteStatus={remoteStatus} onJumpToTodos={onJumpToTodos} />
}
