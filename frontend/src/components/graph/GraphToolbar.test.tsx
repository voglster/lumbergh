/**
 * @vitest-environment jsdom
 */
import { describe, it, expect, vi, afterEach } from 'vitest'
import { render, screen, fireEvent, cleanup } from '@testing-library/react'
import GraphToolbar from './GraphToolbar'

afterEach(cleanup)

const props = {
  mineOnly: false,
  mineAvailable: true,
  onToggleMineOnly: vi.fn(),
  search: '',
  onSearchChange: vi.fn(),
  matchCount: 0,
  searching: false,
  needsHistory: false,
  onStepMatch: vi.fn(),
  onSearchHistory: vi.fn(),
}

describe('GraphToolbar', () => {
  it('keeps the split pane free of the filter row until it is asked for', () => {
    render(<GraphToolbar {...props} />)

    expect(screen.queryByTestId('graph-search-input')).toBeNull()
    expect(screen.queryByTestId('graph-mine-toggle')).toBeNull()

    fireEvent.click(screen.getByTestId('graph-toolbar-toggle'))

    expect(screen.getByTestId('graph-search-input')).toBeTruthy()
    expect(screen.getByTestId('graph-mine-toggle')).toBeTruthy()
  })

  it('collapses back down again', () => {
    render(<GraphToolbar {...props} expandedByDefault />)

    fireEvent.click(screen.getByTestId('graph-toolbar-collapse'))

    expect(screen.queryByTestId('graph-search-input')).toBeNull()
  })

  it('opens with the filters showing in full screen', () => {
    render(<GraphToolbar {...props} expandedByDefault />)

    expect(screen.getByTestId('graph-search-input')).toBeTruthy()
  })

  it('re-applies the default when the pane enters and leaves full screen', () => {
    const { rerender } = render(<GraphToolbar {...props} />)
    expect(screen.queryByTestId('graph-search-input')).toBeNull()

    rerender(<GraphToolbar {...props} expandedByDefault />)
    expect(screen.getByTestId('graph-search-input')).toBeTruthy()

    rerender(<GraphToolbar {...props} expandedByDefault={false} />)
    expect(screen.queryByTestId('graph-search-input')).toBeNull()
  })

  it('marks the collapsed button when a filter is still on', () => {
    render(<GraphToolbar {...props} mineOnly />)

    expect(screen.getByTestId('graph-toolbar-active-dot')).toBeTruthy()
  })
})

describe('the worktrees button', () => {
  const open = { ...props, onOpenWorktrees: vi.fn() }

  it('takes no space at all when the repo has no worktrees', () => {
    render(<GraphToolbar {...open} worktreeCount={0} expandedByDefault />)

    expect(screen.queryByTestId('graph-worktrees-toggle')).toBeNull()
  })

  it('appears with a count once there are worktrees to manage', () => {
    render(<GraphToolbar {...open} worktreeCount={3} expandedByDefault />)

    expect(screen.getByTestId('graph-worktrees-toggle').textContent).toContain('3')
  })

  it('stays hidden when there is no handler to open it', () => {
    render(<GraphToolbar {...props} worktreeCount={3} expandedByDefault />)

    expect(screen.queryByTestId('graph-worktrees-toggle')).toBeNull()
  })

  it('opens the overlay when clicked', () => {
    const onOpenWorktrees = vi.fn()
    render(
      <GraphToolbar
        {...props}
        onOpenWorktrees={onOpenWorktrees}
        worktreeCount={1}
        expandedByDefault
      />
    )

    fireEvent.click(screen.getByTestId('graph-worktrees-toggle'))

    expect(onOpenWorktrees).toHaveBeenCalled()
  })
})

describe('forcing a fresh graph', () => {
  it('offers a refresh alongside the filters', () => {
    render(<GraphToolbar {...props} onRefresh={vi.fn()} expandedByDefault />)

    expect(screen.getByTestId('graph-refresh')).toBeTruthy()
  })

  it('asks for the requery when clicked', () => {
    const onRefresh = vi.fn()
    render(<GraphToolbar {...props} onRefresh={onRefresh} expandedByDefault />)

    fireEvent.click(screen.getByTestId('graph-refresh'))

    expect(onRefresh).toHaveBeenCalled()
  })

  it('reports that it is working, so a slow requery does not look ignored', () => {
    render(<GraphToolbar {...props} onRefresh={vi.fn()} refreshing expandedByDefault />)

    expect(screen.getByTestId('graph-refresh').getAttribute('aria-busy')).toBe('true')
  })
})
