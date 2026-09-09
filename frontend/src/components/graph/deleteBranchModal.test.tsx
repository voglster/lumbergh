/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DeleteBranchModal } from './DeleteBranchModal'
import type { DeleteBranchTarget } from './branchMenu'
import type { GraphWorktree } from '../diff/types'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const worktree = (over: Partial<GraphWorktree> = {}): GraphWorktree => ({
  branch: 'feature',
  headHash: 'abc1234',
  path: '/home/jim/src/aio-worktrees/feature',
  isMain: false,
  isCurrent: false,
  sessionName: 'feature-work',
  ...over,
})

const target = (over: Partial<DeleteBranchTarget> = {}): DeleteBranchTarget => ({
  name: 'feature',
  local: true,
  remote: false,
  ...over,
})

/** Answers the readiness GET, then records every POST the modal makes. */
function stubApi(readiness: object, posts: { url: string; body: unknown }[] = []) {
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/readiness')) {
        return { ok: true, json: async () => readiness } as unknown as Response
      }
      posts.push({ url: String(url), body: JSON.parse(String(init?.body)) })
      return { ok: true, json: async () => ({ status: 'removed' }) } as unknown as Response
    })
  )
  return posts
}

function mount(branch: DeleteBranchTarget, onDone = vi.fn()) {
  render(
    <DeleteBranchModal sessionName="lumbergh" branch={branch} onDone={onDone} onCancel={vi.fn()} />
  )
  return onDone
}

const clean = { blocker: null, landed: true, commits: 0, dirty: 0, processes: [], session: null }

describe('deleting a branch a worktree holds', () => {
  it('names the worktree standing in the way', async () => {
    stubApi(clean)
    mount(target({ worktree: worktree() }))

    expect(await screen.findByText('/home/jim/src/aio-worktrees/feature')).toBeTruthy()
  })

  it('will not offer a delete git is going to refuse', async () => {
    stubApi(clean)
    mount(target({ worktree: worktree() }))

    const button = screen.getByRole('button', { name: 'Delete' })
    expect(button).toHaveProperty('disabled', true)
  })

  it('enables the delete once removing the worktree is acknowledged', async () => {
    stubApi(clean)
    mount(target({ worktree: worktree() }))

    fireEvent.click(screen.getByLabelText(/Also remove the worktree/i))

    expect(screen.getByRole('button', { name: 'Delete' })).toHaveProperty('disabled', false)
  })

  it('states what removing the worktree would destroy, before anything is clicked', async () => {
    stubApi({ ...clean, dirty: 2, blocker: 'dirty', session: 'feature-work' })
    mount(target({ worktree: worktree() }))

    expect(await screen.findByText('2 uncommitted files')).toBeTruthy()
    expect(screen.getByText('session feature-work will be killed')).toBeTruthy()
  })

  it('reaps the worktree and then deletes the branch', async () => {
    const posts = stubApi(clean)
    const onDone = mount(target({ worktree: worktree() }))

    fireEvent.click(screen.getByLabelText(/Also remove the worktree/i))
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(posts.map((p) => p.url)).toEqual([
      expect.stringContaining('/worktrees/reap'),
      expect.stringContaining('/git/delete-branch'),
    ])
    expect(posts[0].body).toMatchObject({ path: worktree().path, force: true })
  })

  it('asks nothing extra of a branch no worktree holds', async () => {
    const posts = stubApi(clean)
    const onDone = mount(target())

    expect(screen.queryByLabelText(/Also remove the worktree/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(posts).toHaveLength(1)
    expect(posts[0].url).toContain('/git/delete-branch')
  })
})
