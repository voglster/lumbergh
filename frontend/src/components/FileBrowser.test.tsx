/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, cleanup, waitFor, fireEvent } from '@testing-library/react'

vi.mock('mermaid', () => ({
  default: { initialize: vi.fn(), render: vi.fn(async () => ({ svg: '' })) },
}))
vi.mock('@uiw/react-markdown-preview', () => ({ default: () => null }))
vi.mock('../hooks/useTheme', () => ({
  useTheme: () => ({ theme: 'dark', setTheme: vi.fn() }),
}))

// jsdom does not implement matchMedia; FileBrowser's useIsDesktop needs it.
if (typeof window !== 'undefined' && !window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList
}

import FileBrowser from './FileBrowser'

const ROOT = {
  root: '/repo',
  files: [
    { path: 'src', type: 'directory', size: null },
    { path: 'README.md', type: 'file', size: 12 },
  ],
}
const SRC = {
  root: '/repo',
  files: [{ path: 'src/app.ts', type: 'file', size: 34 }],
}

function stubFetch() {
  const calls: string[] = []
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url: string) => {
      calls.push(url)
      return { ok: true, json: async () => (url.includes('path=src') ? SRC : ROOT) }
    })
  )
  return calls
}

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('FileBrowser lazy listing', () => {
  it('fetches only the root level on mount', async () => {
    const calls = stubFetch()
    render(<FileBrowser />)
    await waitFor(() => expect(screen.getByText('src')).toBeTruthy())
    expect(calls).toHaveLength(1)
    expect(calls[0]).not.toContain('path=')
  })

  it('fetches a directory when it is expanded', async () => {
    const calls = stubFetch()
    render(<FileBrowser />)
    await waitFor(() => expect(screen.getByText('src')).toBeTruthy())
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => expect(screen.getByText('app.ts')).toBeTruthy())
    expect(calls.some((u) => u.includes('path=src'))).toBe(true)
  })

  it('does not refetch a directory that is collapsed and reopened', async () => {
    const calls = stubFetch()
    render(<FileBrowser />)
    await waitFor(() => expect(screen.getByText('src')).toBeTruthy())
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => expect(screen.getByText('app.ts')).toBeTruthy())
    const afterFirstOpen = calls.filter((u) => u.includes('path=src')).length
    fireEvent.click(screen.getByText('src')) // collapse
    fireEvent.click(screen.getByText('src')) // reopen
    await waitFor(() => expect(screen.getByText('app.ts')).toBeTruthy())
    expect(calls.filter((u) => u.includes('path=src')).length).toBe(afterFirstOpen)
  })

  it('surfaces a failed directory on its own row without blanking the tree', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (url: string) => {
        if (url.includes('path=src')) return { ok: false, status: 403 }
        return { ok: true, json: async () => ROOT }
      })
    )
    render(<FileBrowser />)
    await waitFor(() => expect(screen.getByText('src')).toBeTruthy())
    fireEvent.click(screen.getByText('src'))
    await waitFor(() => expect(screen.getByText('HTTP 403')).toBeTruthy())
    // the rest of the tree is still rendered
    expect(screen.getByText('README.md')).toBeTruthy()
  })
})
