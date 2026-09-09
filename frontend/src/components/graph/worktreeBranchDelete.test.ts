import { describe, it, expect, vi } from 'vitest'
import { deleteBranchWithWorktree, worktreeRisks } from './worktreeBranchDelete'
import type { Poster } from './worktreeBranchDelete'
import type { WorktreeReadiness } from './worktreeBranchDelete'

const readiness = (over: Partial<WorktreeReadiness> = {}): WorktreeReadiness => ({
  blocker: null,
  landed: true,
  commits: 0,
  dirty: 0,
  processes: [],
  session: null,
  ...over,
})

describe('what the confirmation warns about', () => {
  it('says nothing when the worktree holds nothing', () => {
    expect(worktreeRisks(readiness())).toEqual([])
  })

  it('counts uncommitted files', () => {
    expect(worktreeRisks(readiness({ dirty: 3, blocker: 'dirty' }))).toContain(
      '3 uncommitted files'
    )
  })

  it('speaks of one file in the singular', () => {
    expect(worktreeRisks(readiness({ dirty: 1, blocker: 'dirty' }))).toContain('1 uncommitted file')
  })

  it('warns about commits that exist nowhere else', () => {
    expect(worktreeRisks(readiness({ commits: 2, landed: false, blocker: 'unlanded' }))).toContain(
      '2 commits not landed anywhere else'
    )
  })

  it('does not warn about commits that already landed', () => {
    expect(worktreeRisks(readiness({ commits: 2, landed: true }))).toEqual([])
  })

  it('distinguishes unestablished landedness from proven loss', () => {
    expect(worktreeRisks(readiness({ blocker: 'unknown', landed: null, commits: null }))).toContain(
      'could not tell whether its work landed'
    )
  })

  it('warns that a live session will be killed', () => {
    expect(worktreeRisks(readiness({ session: 'KB-50886' }))).toContain(
      'session KB-50886 will be killed'
    )
  })
})

describe('removing the worktree before deleting the branch', () => {
  const wtPath = '/home/jim/src/aio-worktrees/feature'

  it('reaps the worktree first, then deletes the branch', async () => {
    const order: string[] = []
    const post = vi.fn(async (url: string) => {
      order.push(url)
      return { ok: true, body: { status: 'removed' } }
    })

    const result = await deleteBranchWithWorktree(
      { branch: 'feature', worktreePath: wtPath, deleteRemote: false },
      post
    )

    expect(order).toEqual(['/worktrees/reap', '/git/delete-branch'])
    expect(result.ok).toBe(true)
  })

  it('forces the reap, because the operator was shown the risks first', async () => {
    const post = vi.fn<Poster>(async () => ({ ok: true, body: {} }))

    await deleteBranchWithWorktree(
      { branch: 'feature', worktreePath: wtPath, deleteRemote: false },
      post
    )

    expect(post.mock.calls[0][1]).toEqual({ path: wtPath, force: true })
  })

  it('leaves the branch alone when the reap fails', async () => {
    const post = vi.fn(async (url: string) =>
      url === '/worktrees/reap'
        ? { ok: false, body: { error: 'worktree is dirty' } }
        : { ok: true, body: {} }
    )

    const result = await deleteBranchWithWorktree(
      { branch: 'feature', worktreePath: wtPath, deleteRemote: false },
      post
    )

    expect(post).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
    expect(result.error).toContain('dirty')
  })

  it('treats a reap that reports an error in a 200 body as a failure', async () => {
    // `POST /api/worktrees/reap` answers a refusal with 200 and an `error` key,
    // so HTTP status alone would march on and delete the branch anyway.
    const post = vi.fn<Poster>(async () => ({ ok: true, body: { error: 'unlanded commits' } }))

    const result = await deleteBranchWithWorktree(
      { branch: 'feature', worktreePath: wtPath, deleteRemote: false },
      post
    )

    expect(post).toHaveBeenCalledTimes(1)
    expect(result.ok).toBe(false)
  })

  it('skips the reap entirely when no worktree is attached', async () => {
    const post = vi.fn<Poster>(async () => ({ ok: true, body: {} }))

    await deleteBranchWithWorktree(
      { branch: 'feature', worktreePath: null, deleteRemote: true },
      post
    )

    expect(post).toHaveBeenCalledTimes(1)
    expect(post.mock.calls[0][0]).toBe('/git/delete-branch')
    expect(post.mock.calls[0][1]).toMatchObject({ branch: 'feature', delete_remote: true })
  })
})
