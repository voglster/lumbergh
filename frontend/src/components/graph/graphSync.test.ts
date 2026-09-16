import { describe, it, expect } from 'vitest'
import { applyGraphResponse, GraphCursor, type GraphResponse } from './graphSync'
import type { GraphCommit, GraphData } from '../diff/types'

function commit(hash: string): GraphCommit {
  return {
    hash,
    shortHash: '',
    message: `commit ${hash}`,
    author: 'someone',
    relativeDate: '2026-01-01T00:00:00Z',
    parents: [],
    refs: [],
  }
}

function graph(hashes: string[], version = 'v1'): GraphData {
  return {
    commits: hashes.map(commit),
    branches: [],
    head: { hash: hashes[0] ?? '', branch: 'main' },
    workingChanges: null,
    worktrees: [],
    version,
  }
}

const SMALL_FIELDS = {
  branches: [],
  head: { hash: 'aaaaaaaaaaaa', branch: 'main' },
  workingChanges: null,
  worktrees: [],
}

describe('applyGraphResponse', () => {
  it('keeps the current graph when nothing changed', () => {
    const previous = graph(['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])

    const { graph: next, cursorValid } = applyGraphResponse(previous, {
      unchanged: true,
      version: 'v1',
    })

    expect(next).toBe(previous)
    expect(cursorValid).toBe(true)
  })

  it('replaces everything on a keyframe', () => {
    const previous = graph(['old1old1old1'])

    const { graph: next } = applyGraphResponse(previous, graph(['newnewnewnew'], 'v2'))

    expect(next!.commits.map((c) => c.hash)).toEqual(['newnewnewnew'])
  })

  it('derives shortHash on keyframe commits', () => {
    const { graph: next } = applyGraphResponse(null, graph(['abcdef123456']))

    expect(next!.commits[0].shortHash).toBe('abcdef1')
  })

  it('merges added commits into the order the server describes', () => {
    const previous = graph(['bbbbbbbbbbbb', 'cccccccccccc'])

    const { graph: next, cursorValid } = applyGraphResponse(previous, {
      delta: true,
      version: 'v2',
      added: [commit('aaaaaaaaaaaa')],
      order: ['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc'],
      refs: {},
      ...SMALL_FIELDS,
    } as GraphResponse)

    expect(cursorValid).toBe(true)
    expect(next!.commits.map((c) => c.hash)).toEqual([
      'aaaaaaaaaaaa',
      'bbbbbbbbbbbb',
      'cccccccccccc',
    ])
    expect(next!.commits[0].shortHash).toBe('aaaaaaa')
  })

  it('evicts commits the server left out of the order', () => {
    const previous = graph(['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc'])

    const { graph: next } = applyGraphResponse(previous, {
      delta: true,
      version: 'v2',
      added: [],
      order: ['aaaaaaaaaaaa', 'bbbbbbbbbbbb'],
      refs: {},
      ...SMALL_FIELDS,
    } as GraphResponse)

    expect(next!.commits.map((c) => c.hash)).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])
  })

  it('invalidates the cursor when the order names a commit we never received', () => {
    const previous = graph(['bbbbbbbbbbbb'])

    const { graph: next, cursorValid } = applyGraphResponse(previous, {
      delta: true,
      version: 'v2',
      added: [],
      order: ['missingmissi', 'bbbbbbbbbbbb'],
      refs: {},
      ...SMALL_FIELDS,
    } as GraphResponse)

    expect(cursorValid).toBe(false)
    expect(next).toBe(previous)
  })

  it('invalidates the cursor when a delta arrives with nothing to apply it to', () => {
    const { cursorValid } = applyGraphResponse(null, {
      delta: true,
      version: 'v2',
      added: [],
      order: ['aaaaaaaaaaaa'],
      refs: {},
      ...SMALL_FIELDS,
    } as GraphResponse)

    expect(cursorValid).toBe(false)
  })

  it('applies the keep shorthand without an explicit order', () => {
    const previous = graph(['bbbbbbbbbbbb', 'cccccccccccc'])

    const { graph: next, cursorValid } = applyGraphResponse(previous, {
      delta: true,
      version: 'v2',
      added: [commit('aaaaaaaaaaaa')],
      keep: 2,
      refs: {},
      ...SMALL_FIELDS,
    } as GraphResponse)

    expect(cursorValid).toBe(true)
    expect(next!.commits.map((c) => c.hash)).toEqual([
      'aaaaaaaaaaaa',
      'bbbbbbbbbbbb',
      'cccccccccccc',
    ])
    expect(next!.commits[0].shortHash).toBe('aaaaaaa')
  })

  it('drops the tail the keep shorthand excludes', () => {
    const previous = graph(['aaaaaaaaaaaa', 'bbbbbbbbbbbb', 'cccccccccccc'])

    const { graph: next } = applyGraphResponse(previous, {
      delta: true,
      version: 'v2',
      added: [],
      keep: 2,
      refs: {},
      ...SMALL_FIELDS,
    } as GraphResponse)

    expect(next!.commits.map((c) => c.hash)).toEqual(['aaaaaaaaaaaa', 'bbbbbbbbbbbb'])
  })

  it('invalidates the cursor when keep exceeds what we hold', () => {
    const previous = graph(['aaaaaaaaaaaa'])

    const { cursorValid } = applyGraphResponse(previous, {
      delta: true,
      version: 'v2',
      added: [],
      keep: 99,
      refs: {},
      ...SMALL_FIELDS,
    } as GraphResponse)

    expect(cursorValid).toBe(false)
  })

  it('moves a branch badge off the commit it used to point at', () => {
    const previous = graph(['bbbbbbbbbbbb'])
    previous.commits[0].refs = [{ name: 'dev', local: true, remote: false }]

    const { graph: next } = applyGraphResponse(previous, {
      delta: true,
      version: 'v2',
      added: [{ ...commit('aaaaaaaaaaaa'), refs: [{ name: 'dev', local: true, remote: false }] }],
      keep: 1,
      refs: { aaaaaaaaaaaa: [{ name: 'dev', local: true, remote: false }] },
      ...SMALL_FIELDS,
    } as GraphResponse)

    expect(next!.commits.map((c) => c.refs.map((r) => r.name))).toEqual([['dev'], []])
  })

  it('refreshes the pushed flag on commits it already held', () => {
    const previous = graph(['bbbbbbbbbbbb'])
    previous.commits[0].pushed = false

    const { graph: next } = applyGraphResponse(previous, {
      delta: true,
      version: 'v2',
      added: [],
      keep: 1,
      refs: {},
      unpushed: [],
      ...SMALL_FIELDS,
    } as GraphResponse)

    expect(next!.commits[0].pushed).toBe(true)
  })

  it('carries the small fields through a delta', () => {
    const previous = graph(['bbbbbbbbbbbb'])

    const { graph: next } = applyGraphResponse(previous, {
      delta: true,
      version: 'v2',
      added: [],
      keep: 1,
      refs: {},
      ...SMALL_FIELDS,
      workingChanges: { files: 3, staged: 1, unstaged: 2 },
    } as GraphResponse)

    expect(next!.workingChanges).toEqual({ files: 3, staged: 1, unstaged: 2 })
    expect(next!.version).toBe('v2')
  })
})

describe('GraphCursor', () => {
  it('asks for everything when it holds nothing', () => {
    const cursor = new GraphCursor()

    expect(cursor.headers()).toEqual({})
    expect(cursor.sinceParam()).toBe('')
  })

  it('offers both tokens once a response has been folded in', () => {
    const cursor = new GraphCursor()

    cursor.advance('"abc"', 'v2', true)

    expect(cursor.headers()).toEqual({ 'If-None-Match': '"abc"' })
    expect(cursor.sinceParam()).toBe('&since=v2')
  })

  it('drops the delta cursor when a response could not be applied', () => {
    const cursor = new GraphCursor()
    cursor.advance('"abc"', 'v2', true)

    cursor.advance('"def"', 'v3', false)

    expect(cursor.sinceParam()).toBe('')
  })

  it('offers no way to be answered "nothing new" after a reset', () => {
    const cursor = new GraphCursor()
    cursor.advance('"abc"', 'v2', true)

    cursor.reset()

    expect(cursor.headers()).toEqual({})
    expect(cursor.sinceParam()).toBe('')
  })
})
