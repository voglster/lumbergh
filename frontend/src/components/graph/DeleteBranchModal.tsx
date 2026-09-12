import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle } from 'lucide-react'

import { WorktreeRiskPanel } from '../worktree/WorktreeRiskPanel'

import { getApiBase } from '../../config'
import { deleteBranchWithWorktree } from './worktreeBranchDelete'
import type { Poster, WorktreeReadiness } from './worktreeBranchDelete'
import type { DeleteBranchTarget } from './branchMenu'

export function DeleteBranchModal({
  sessionName,
  branch,
  onDone,
  onCancel,
}: {
  sessionName?: string
  branch: DeleteBranchTarget | null
  onDone: () => void
  onCancel: () => void
}) {
  const [isDeleting, setIsDeleting] = useState(false)
  const [deleteRemote, setDeleteRemote] = useState(false)
  const [removeWorktree, setRemoveWorktree] = useState(false)
  const [readiness, setReadiness] = useState<WorktreeReadiness | null>(null)
  const worktree = branch?.worktree

  /** What removing the attached worktree would cost, asked as the modal opens so
   * the first screen can state it — a confirmation that hides the price is not
   * one. Unreachable leaves `readiness` null, which reads as "unknown", never as
   * "nothing at stake". */
  useEffect(() => {
    if (!worktree) return
    let cancelled = false
    setReadiness(null)
    ;(async () => {
      try {
        const res = await fetch(
          `${getApiBase()}/worktrees/readiness?path=${encodeURIComponent(worktree.path)}`
        )
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setReadiness(data)
      } catch {
        // Left null: the modal says it could not tell.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [worktree])

  const post = useCallback<Poster>(
    async (path, payload) => {
      const url =
        path === '/worktrees/reap'
          ? `${getApiBase()}/worktrees/reap`
          : `${getApiBase()}/sessions/${sessionName}/git/delete-branch`
      const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const body = await res.json().catch(() => ({}))
      return { ok: res.ok, body }
    },
    [sessionName]
  )

  const handleConfirm = useCallback(async () => {
    if (!sessionName || !branch) return
    setIsDeleting(true)
    try {
      const result = await deleteBranchWithWorktree(
        {
          branch: branch.name,
          worktreePath: worktree && removeWorktree ? worktree.path : null,
          deleteRemote,
          remoteOnly: !branch.local && branch.remote,
        },
        post
      )
      if (!result.ok) {
        alert(result.error || 'Delete failed')
        return
      }
      onDone()
    } catch {
      alert('Failed to delete branch')
    } finally {
      setIsDeleting(false)
    }
  }, [sessionName, branch, worktree, removeWorktree, deleteRemote, post, onDone])

  // Reset checkboxes when branch changes
  useEffect(() => {
    setDeleteRemote(false)
    setRemoveWorktree(false)
  }, [branch?.name])

  if (!branch) return null

  const isRemoteOnly = !branch.local && branch.remote

  return (
    <div
      className="fixed inset-0 z-[100] flex items-end sm:items-center justify-center bg-black/50"
      onClick={() => !isDeleting && onCancel()}
      onKeyDown={(e) => {
        if (e.key === 'Escape' && !isDeleting) onCancel()
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
          <h3 className="text-lg font-semibold text-text-primary">Delete branch</h3>
        </div>
        <p className="text-sm text-text-secondary mb-1">
          Are you sure you want to delete {isRemoteOnly ? 'the remote branch' : 'the branch'}{' '}
          <code className="font-mono font-medium text-danger">{branch.name}</code>?
        </p>
        <p className="text-xs text-text-muted mb-4">
          Commits will remain in the repository until garbage collected.
        </p>
        {worktree && (
          <WorktreeRiskPanel
            lead="This branch is checked out in a worktree, so git cannot delete it on its own:"
            path={worktree.path}
            readiness={readiness}
            removeWorktree={removeWorktree}
            setRemoveWorktree={setRemoveWorktree}
          />
        )}
        {branch.local && branch.remote && (
          <label className="flex items-center gap-2 mb-4 cursor-pointer group">
            <input
              type="checkbox"
              checked={deleteRemote}
              onChange={(e) => setDeleteRemote(e.target.checked)}
              className="w-4 h-4 rounded border-border-default bg-bg-elevated text-danger focus:ring-danger/30 accent-danger"
            />
            <span className="text-sm text-text-secondary group-hover:text-text-primary">
              Also delete remote branch
            </span>
          </label>
        )}
        <div className="flex flex-col-reverse sm:flex-row gap-2 sm:justify-end">
          <button
            onClick={onCancel}
            disabled={isDeleting}
            className="px-4 py-2.5 rounded-lg text-sm font-medium bg-bg-elevated text-text-secondary hover:bg-control-bg-hover"
          >
            Cancel
          </button>
          <button
            onClick={handleConfirm}
            disabled={isDeleting || (!!worktree && !removeWorktree)}
            title={
              worktree && !removeWorktree
                ? 'git cannot delete a branch that a worktree has checked out'
                : undefined
            }
            className="px-4 py-2.5 rounded-lg text-sm font-medium bg-danger text-white hover:bg-danger/80 disabled:opacity-50"
          >
            {isDeleting ? 'Deleting...' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  )
}
