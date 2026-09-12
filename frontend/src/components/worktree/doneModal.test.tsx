/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, fireEvent, waitFor } from '@testing-library/react'
import { DoneModal } from './DoneModal'
import type { DoneSession } from '../../utils/doneDestination'

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

const clean = { blocker: null, landed: true, commits: 0, dirty: 0, processes: [], session: null }

const worktreeSession = (over: Partial<DoneSession> = {}): DoneSession => ({
  name: 'KB-50886',
  type: 'worktree',
  workdir: '/home/jim/src/aio-worktrees/KB-50886',
  worktreeParentRepo: '/home/jim/src/aio',
  ...over,
})

/** Answers readiness, records the DELETE, and reports where we were sent. */
function harness(readiness: object = clean, session = worktreeSession()) {
  const deletes: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string, init?: RequestInit) => {
      if (String(url).includes('/readiness')) {
        return { ok: true, json: async () => readiness } as unknown as Response
      }
      if (init?.method === 'DELETE') deletes.push(String(url))
      return { ok: true, json: async () => ({ status: 'deleted' }) } as unknown as Response
    })
  )
  const onDone = vi.fn()
  render(<DoneModal session={session} onFinished={onDone} onCancel={vi.fn()} />)
  return { deletes, onDone }
}

describe('finishing with a session', () => {
  it('shows what tearing down the worktree would destroy', async () => {
    harness({ ...clean, dirty: 2, blocker: 'dirty', commits: 3, landed: false })

    expect(await screen.findByText('2 uncommitted files')).toBeTruthy()
    expect(screen.getByText('3 commits not landed anywhere else')).toBeTruthy()
  })

  it('offers to remove the worktree, already ticked', async () => {
    harness()

    const box = (await screen.findByLabelText(/Also remove the worktree/i)) as HTMLInputElement
    expect(box.checked).toBe(true)
  })

  it('closes the session and cleans the worktree up', async () => {
    const { deletes, onDone } = harness()
    await screen.findByLabelText(/Also remove the worktree/i)

    fireEvent.click(screen.getByRole('button', { name: /^Done$/ }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(deletes).toHaveLength(1)
    expect(deletes[0]).toContain('/sessions/KB-50886')
    expect(deletes[0]).toContain('cleanup_worktree=true')
  })

  it('leaves the worktree standing when you untick the box', async () => {
    const { deletes } = harness()

    fireEvent.click(await screen.findByLabelText(/Also remove the worktree/i))
    fireEvent.click(screen.getByRole('button', { name: /^Done$/ }))

    await waitFor(() => expect(deletes).toHaveLength(1))
    expect(deletes[0]).toContain('cleanup_worktree=false')
  })

  it('asks a plain session nothing about worktrees', async () => {
    const { deletes, onDone } = harness(
      clean,
      worktreeSession({ type: 'direct', worktreeParentRepo: null })
    )

    expect(screen.queryByLabelText(/Also remove the worktree/i)).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: /^Done$/ }))

    await waitFor(() => expect(onDone).toHaveBeenCalled())
    expect(deletes[0]).toContain('cleanup_worktree=false')
  })

  it('keeps you where you are when the close fails', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) =>
        String(url).includes('/readiness')
          ? ({ ok: true, json: async () => clean } as unknown as Response)
          : ({ ok: false, json: async () => ({ detail: 'tmux said no' }) } as unknown as Response)
      )
    )
    vi.stubGlobal('alert', vi.fn())
    const onDone = vi.fn()
    render(<DoneModal session={worktreeSession()} onFinished={onDone} onCancel={vi.fn()} />)
    await screen.findByLabelText(/Also remove the worktree/i)

    fireEvent.click(screen.getByRole('button', { name: /^Done$/ }))

    await waitFor(() => expect(alert).toHaveBeenCalled())
    expect(onDone).not.toHaveBeenCalled()
  })
})
