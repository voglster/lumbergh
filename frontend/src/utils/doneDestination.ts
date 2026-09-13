/** Where the UI goes when you finish with a session.
 *
 * Lumbergh stores no parent-session name — a worktree session knows only the
 * repo path it was branched from. The session sitting in that repo is the one
 * you left to come here, so that is where finishing returns you.
 */

export interface DoneSession {
  name: string
  type?: string | null
  workdir?: string | null
  worktreeParentRepo?: string | null
}

export interface SessionRow {
  name: string
  workdir?: string | null
}

const normalize = (p: string | null | undefined): string => (p ?? '').replace(/\/+$/, '')

export function doneDestination(session: DoneSession, sessions: SessionRow[]): string {
  const parentRepo = normalize(session.worktreeParentRepo)
  if (!parentRepo) return '/'

  const parent = sessions.find(
    (s) => normalize(s.workdir) === parentRepo && s.name !== session.name
  )
  return parent ? `/session/${parent.name}` : '/'
}

/** Whether finishing is a thing you can do to this session.
 *
 * Only a worktree session — one spawned off another repo to do one job, which
 * ends. A main project session is the place you come *back* to: closing it from
 * a Done button is never what anyone means, and there is no parent to return to
 * afterwards.
 */
export function canFinish(session: DoneSession | null): boolean {
  return session?.type === 'worktree' && !!session.worktreeParentRepo
}
