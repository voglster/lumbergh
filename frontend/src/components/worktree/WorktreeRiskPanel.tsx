/** What a worktree holds that removing it would destroy, and the acknowledgement
 * that removing it is part of what you just asked for.
 *
 * Shared by the two places that tear a worktree down — deleting the branch it has
 * checked out, and finishing with the session living in it. Both owe the same
 * answer to the same question, so both ask it the same way. The lead line differs
 * because the reason you are being asked differs; everything below it does not.
 */
import { AlertTriangle } from 'lucide-react'

import { worktreeRisks } from '../graph/worktreeBranchDelete'
import type { WorktreeReadiness } from '../graph/worktreeBranchDelete'

export function WorktreeRiskPanel({
  lead,
  path,
  readiness,
  removeWorktree,
  setRemoveWorktree,
}: {
  /** Why this panel is on screen, in one line. */
  lead: string
  path: string
  /** Null while the answer is still in flight — which reads as unknown, never as safe. */
  readiness: WorktreeReadiness | null
  removeWorktree: boolean
  setRemoveWorktree: (v: boolean) => void
}) {
  const risks = readiness ? worktreeRisks(readiness) : []
  return (
    <div className="mb-4 rounded-lg border border-warning/30 bg-warning/10 p-3">
      <p className="text-xs text-text-secondary mb-1.5">{lead}</p>
      <p className="font-mono text-xs text-text-primary break-all mb-2">{path}</p>
      {readiness === null ? (
        <p className="text-xs text-text-muted">Checking what it holds...</p>
      ) : (
        <ul className="text-xs space-y-0.5">
          {risks.map((risk) => (
            <li key={risk} className="flex items-start gap-1.5 text-warning">
              <AlertTriangle size={12} className="mt-0.5 shrink-0" />
              <span>{risk}</span>
            </li>
          ))}
          {risks.length === 0 && (
            <li className="text-text-muted">Nothing uncommitted, nothing to lose.</li>
          )}
        </ul>
      )}
      <label className="flex items-start gap-2 mt-3 cursor-pointer group">
        <input
          type="checkbox"
          checked={removeWorktree}
          onChange={(e) => setRemoveWorktree(e.target.checked)}
          className="w-4 h-4 mt-0.5 rounded border-border-default bg-bg-elevated text-danger focus:ring-danger/30 accent-danger"
        />
        <span className="text-sm text-text-secondary group-hover:text-text-primary">
          Also remove the worktree
          {risks.length > 0 && (
            <span className="block text-xs text-warning">
              This destroys everything listed above.
            </span>
          )}
        </span>
      </label>
    </div>
  )
}
