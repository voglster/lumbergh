/** Finishing with a session, from inside it.
 *
 * Tearing a worker down used to mean leaving it: out to the dashboard, find the
 * card, press X. By then you have lost the place you were. This says done where
 * you are, and puts you back in the session you came from.
 */
import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

import { getApiBase } from '../../config'
import { WorktreeRiskPanel } from './WorktreeRiskPanel'
import type { WorktreeReadiness } from '../graph/worktreeBranchDelete'
import type { DoneSession } from '../../utils/doneDestination'

export function DoneModal({
  session,
  onFinished,
  onCancel,
}: {
  session: DoneSession
  /** Called only once the session is actually gone. */
  onFinished: () => void
  onCancel: () => void
}) {
  const isWorktree = session.type === 'worktree' && !!session.workdir
  // Ticked by default here, unlike the branch-delete flow: saying you are done
  // with a worker is saying you are done with its tree. Untick to keep it.
  const [removeWorktree, setRemoveWorktree] = useState(isWorktree)
  const [readiness, setReadiness] = useState<WorktreeReadiness | null>(null)
  const [isClosing, setIsClosing] = useState(false)

  useEffect(() => {
    if (!isWorktree) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(
          `${getApiBase()}/worktrees/readiness?path=${encodeURIComponent(session.workdir!)}`
        )
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setReadiness(data)
      } catch {
        // Left null, which the panel reports as unknown rather than as safe.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [isWorktree, session.workdir])

  const handleConfirm = useCallback(async () => {
    setIsClosing(true)
    try {
      const cleanup = isWorktree && removeWorktree
      const res = await fetch(
        `${getApiBase()}/sessions/${session.name}?cleanup_worktree=${cleanup}`,
        { method: 'DELETE' }
      )
      if (!res.ok) {
        const body = await res.json().catch(() => ({}))
        alert(body.detail || `Could not close the session (HTTP ${res.status})`)
        return
      }
      onFinished()
    } catch {
      alert('Could not close the session')
    } finally {
      setIsClosing(false)
    }
  }, [session.name, isWorktree, removeWorktree, onFinished])

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50"
      onClick={() => !isClosing && onCancel()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !isClosing) onCancel()
      }}
    >
      <div
        className="w-full sm:max-w-sm mx-0 sm:mx-4 bg-bg-surface border border-danger/30 rounded-t-2xl sm:rounded-xl shadow-xl p-5"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center gap-2.5 mb-3">
          <div className="p-2 rounded-lg bg-danger/15">
            <AlertTriangle size={18} className="text-danger" />
          </div>
          <h3 className="text-lg font-semibold text-text-primary">Done with this session?</h3>
        </div>
        <p className="text-sm text-text-secondary mb-4">
          <code className="font-mono font-medium text-danger">{session.name}</code> will be closed
          and its terminal killed.
        </p>
        {isWorktree && (
          <WorktreeRiskPanel
            lead="This session is running in a worktree:"
            path={session.workdir!}
            readiness={readiness}
            removeWorktree={removeWorktree}
            setRemoveWorktree={setRemoveWorktree}
          />
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            onClick={onCancel}
            disabled={isClosing}
            className="px-4 py-2.5 rounded-lg text-sm font-medium bg-bg-elevated text-text-secondary hover:bg-control-bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isClosing}
            className="px-4 py-2.5 rounded-lg text-sm font-medium bg-danger text-white hover:bg-danger/80 disabled:opacity-50"
          >
            {isClosing ? 'Closing...' : 'Done'}
          </button>
        </div>
      </div>
    </div>
  )
}
