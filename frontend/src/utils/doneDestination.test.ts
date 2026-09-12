import { describe, it, expect } from 'vitest'
import { doneDestination } from './doneDestination'
import type { DoneSession } from './doneDestination'

const sessions = [
  { name: 'lumbergh', workdir: '/home/jim/src/lumbergh' },
  { name: 'aio', workdir: '/home/jim/src/aio' },
]

const worker = (over: Partial<DoneSession> = {}): DoneSession => ({
  name: 'KB-50886',
  type: 'worktree',
  workdir: '/home/jim/src/aio-worktrees/KB-50886',
  worktreeParentRepo: '/home/jim/src/aio',
  ...over,
})

describe('where finishing a session sends you', () => {
  it('returns to the session the worktree was branched from', () => {
    expect(doneDestination(worker(), sessions)).toBe('/session/aio')
  })

  it('falls back to the dashboard when the parent repo has no session open', () => {
    expect(doneDestination(worker({ worktreeParentRepo: '/home/jim/src/other' }), sessions)).toBe(
      '/'
    )
  })

  it('sends a plain session to the dashboard, having no parent to return to', () => {
    expect(doneDestination(worker({ type: 'direct', worktreeParentRepo: null }), sessions)).toBe(
      '/'
    )
  })

  it('ignores a trailing slash on either side of the comparison', () => {
    expect(doneDestination(worker({ worktreeParentRepo: '/home/jim/src/aio/' }), sessions)).toBe(
      '/session/aio'
    )
  })

  it('never sends a session back to itself', () => {
    // A worktree whose parent repo somehow resolves to its own row would
    // navigate to the session that is being torn down.
    const self = worker({ worktreeParentRepo: '/home/jim/src/aio-worktrees/KB-50886' })
    expect(doneDestination(self, [...sessions, { name: 'KB-50886', workdir: self.workdir }])).toBe(
      '/'
    )
  })
})
