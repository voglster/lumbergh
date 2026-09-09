/** Deleting a branch that a worktree has checked out.
 *
 * `git branch -D` refuses outright while a worktree holds the branch, so the
 * only way through is to remove the worktree first. That is two writes, and the
 * order matters: reaping is the destructive half, so a failed reap must stop the
 * whole thing rather than leave a removed branch behind a surviving tree.
 */
import type { GraphWorktree } from '../diff/types'

/** `GET /api/worktrees/readiness` — what reaping this worktree would cost. */
export interface WorktreeReadiness {
  /** Why an un-forced reap would refuse: `dirty`, `unlanded`, `unknown`, or none. */
  blocker: string | null
  /** `null` when landedness could not be established, which is not the same as `false`. */
  landed: boolean | null
  commits: number | null
  dirty: number | null
  processes: unknown[]
  session: string | null
}

export interface PostResult {
  ok: boolean
  body: { error?: string; detail?: string; status?: string }
}

export type Poster = (url: string, payload: Record<string, unknown>) => Promise<PostResult>

/** The plain-language cost of removing this worktree, one line per thing at stake.
 *
 * Empty means nothing is lost, and the confirmation can stay quiet. Landed
 * commits are not a risk; commits whose fate is *unknown* are, and the two are
 * reported differently because `reap_readiness` distinguishes them deliberately.
 *
 * `describeLoss` in `utils/reapLoss` answers the same question one moment later,
 * from a refusal reap already returned. It reads a different payload and owes a
 * single sentence rather than a list, which is why the two stay separate.
 */
export function worktreeRisks(r: WorktreeReadiness): string[] {
  const risks: string[] = []
  if (r.dirty) {
    risks.push(`${r.dirty} uncommitted file${r.dirty === 1 ? '' : 's'}`)
  }
  if (r.blocker === 'unknown') {
    risks.push('could not tell whether its work landed')
  } else if (r.landed === false && r.commits) {
    risks.push(`${r.commits} commit${r.commits === 1 ? '' : 's'} not landed anywhere else`)
  }
  if (r.session) {
    risks.push(`session ${r.session} will be killed`)
  }
  return risks
}

export interface DeleteRequest {
  branch: string
  /** The attached worktree to remove first, or null when the branch is free. */
  worktreePath: string | null
  deleteRemote: boolean
  remoteOnly?: boolean
}

/** A refusal, whether it arrived as a status code or as an `error` in a 200 body.
 *
 * `POST /api/worktrees/reap` answers a refused reap with 200 and an `error` key,
 * so trusting the status alone would march on and delete the branch out from
 * under a worktree that is still standing. */
function failure(res: PostResult): string | null {
  if (!res.ok) return res.body.error ?? res.body.detail ?? 'request failed'
  return res.body.error ?? null
}

export async function deleteBranchWithWorktree(
  req: DeleteRequest,
  post: Poster
): Promise<{ ok: boolean; error?: string }> {
  if (req.worktreePath) {
    // Forced: the operator has already been shown every risk that an un-forced
    // reap would have refused on, so refusing again here would only be a dead end.
    const reaped = await post('/worktrees/reap', { path: req.worktreePath, force: true })
    const reapError = failure(reaped)
    if (reapError) return { ok: false, error: `Could not remove the worktree: ${reapError}` }
  }

  const deleted = await post('/git/delete-branch', {
    branch: req.branch,
    delete_remote: req.deleteRemote,
    remote_only: req.remoteOnly ?? false,
  })
  const deleteError = failure(deleted)
  return deleteError ? { ok: false, error: deleteError } : { ok: true }
}

/** The worktree standing in the way of deleting `branch`, if any.
 *
 * The current worktree is excluded: deleting the branch you are standing on is
 * refused earlier and for a different reason, and reaping your own tree out from
 * under yourself is never what was meant. */
export function worktreeHolding(
  branch: string,
  worktrees: GraphWorktree[] | undefined
): GraphWorktree | undefined {
  return worktrees?.find((w) => w.branch === branch && !w.isCurrent && !w.isMain)
}
