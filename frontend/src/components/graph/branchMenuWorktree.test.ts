import { describe, it, expect, vi } from 'vitest'
import { buildBranchMenuItems } from './branchMenu'
import type { MenuBranchInfo } from './branchMenu'
import type { GraphWorktree } from '../diff/types'

const branch = (name = 'feature'): MenuBranchInfo => ({
  name,
  local: true,
  remote: false,
  commitHash: 'abc1234def',
  commitShortHash: 'abc1234',
  x: 0,
  y: 0,
})

const held = (over: Partial<GraphWorktree> = {}): GraphWorktree => ({
  branch: 'feature',
  headHash: 'abc1234',
  path: '/home/jim/src/aio-worktrees/feature',
  isMain: false,
  isCurrent: false,
  sessionName: 'feature-work',
  ...over,
})

function build(heldBy?: GraphWorktree, setDeleteBranchConfirm = vi.fn()) {
  return buildBranchMenuItems(
    branch(),
    false,
    false,
    vi.fn(),
    vi.fn(),
    vi.fn(),
    setDeleteBranchConfirm,
    vi.fn(),
    heldBy
  )
}

describe('a branch another worktree has checked out', () => {
  it('offers checkout when nothing holds the branch', () => {
    expect(build().map((i) => i.key)).toContain('checkout')
  })

  it('does not offer a checkout that git will refuse', () => {
    expect(build(held()).map((i) => i.key)).not.toContain('checkout')
  })

  it('says which worktree holds it instead, naming the session', () => {
    const item = build(held()).find((i) => i.key === 'held-by-worktree')
    expect(item).toBeTruthy()
    expect(String(item!.label)).toContain('feature-work')
  })

  it('falls back to the path when no session is attached', () => {
    const item = build(held({ sessionName: null })).find((i) => i.key === 'held-by-worktree')
    expect(String(item!.label)).toContain('aio-worktrees/feature')
  })
})

describe('deleting a branch a worktree holds', () => {
  it('tells the confirmation which worktree stands in the way', () => {
    const setConfirm = vi.fn()
    build(held(), setConfirm)
      .find((i) => i.key === 'delete')!
      .onClick()

    expect(setConfirm).toHaveBeenCalledWith(
      expect.objectContaining({ name: 'feature', worktree: held() })
    )
  })

  it('leaves the worktree out when nothing holds the branch', () => {
    const setConfirm = vi.fn()
    build(undefined, setConfirm)
      .find((i) => i.key === 'delete')!
      .onClick()

    expect(setConfirm.mock.calls[0][0].worktree).toBeUndefined()
  })
})
