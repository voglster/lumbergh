import { useEffect, useState } from 'react'
import { ChevronDown, ChevronUp, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react'

interface Props {
  mineOnly: boolean
  /** False once a payload reports no resolvable git identity to filter by. */
  mineAvailable: boolean
  onToggleMineOnly: () => void
  /** Throw away every cached copy of the graph — the server's and our own — and
   * draw it again from scratch. The poll cannot do this for us: it asks whether
   * anything changed, and a view that is wedged is one where nothing looks like
   * it did. */
  onRefresh?: () => void
  /** True while that requery is in flight. */
  refreshing?: boolean
  onOpenReflog?: () => void
  onOpenWorktrees?: () => void
  /** Worktrees of this repo, excluding the main checkout. Zero hides the button
   * entirely rather than showing an empty one — the row is scarce space. */
  worktreeCount?: number
  search: string
  onSearchChange: (value: string) => void
  /** How many loaded commits the query selects. */
  matchCount: number
  /** True while the query is non-empty, whether or not anything matched. */
  searching: boolean
  /** True when only a history search can answer the query (a `file:` filter). */
  needsHistory: boolean
  onStepMatch: (delta: number) => void
  onSearchHistory: () => void
  /** Where the toolbar starts out. Full screen has vertical space to spare, so
   *  it opens expanded; a split pane starts collapsed to a single button and
   *  keeps its whole height for commits. Flipping it re-applies the default. */
  expandedByDefault?: boolean
}

function CollapsedToolbar({ filtered, onExpand }: { filtered: boolean; onExpand: () => void }) {
  return (
    <button
      data-testid="graph-toolbar-toggle"
      onClick={onExpand}
      aria-expanded={false}
      title="Search and filter commits"
      className="absolute top-1 right-2 z-30 flex items-center gap-1 px-2 py-1 rounded-sm text-xs ring-1 bg-bg-surface/90 text-text-secondary ring-border-default hover:bg-control-bg-hover backdrop-blur-sm"
    >
      <SlidersHorizontal size={12} />
      {filtered && (
        <span
          data-testid="graph-toolbar-active-dot"
          className="w-1.5 h-1.5 rounded-full bg-action"
        />
      )}
    </button>
  )
}

function RefreshButton({
  onRefresh,
  refreshing,
}: {
  onRefresh?: () => void
  refreshing?: boolean
}) {
  if (!onRefresh) return null
  return (
    <button
      data-testid="graph-refresh"
      onClick={onRefresh}
      disabled={!!refreshing}
      aria-busy={!!refreshing}
      title="Rebuild the graph from scratch, ignoring every cached copy"
      className="p-1 rounded-sm ring-1 bg-control-bg text-text-secondary ring-border-default hover:bg-control-bg-hover disabled:opacity-40 shrink-0"
    >
      <RefreshCw size={12} className={refreshing ? 'animate-spin' : undefined} />
    </button>
  )
}

function ExpandedToolbar({
  mineOnly,
  mineAvailable,
  onToggleMineOnly,
  onRefresh,
  refreshing,
  onOpenReflog,
  onOpenWorktrees,
  worktreeCount = 0,
  search,
  onSearchChange,
  matchCount,
  searching,
  needsHistory,
  onStepMatch,
  onSearchHistory,
  onCollapse,
}: Props & { onCollapse: () => void }) {
  const active = mineOnly && mineAvailable

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-default bg-bg-surface/50">
      <button
        data-testid="graph-mine-toggle"
        onClick={onToggleMineOnly}
        disabled={!mineAvailable}
        aria-pressed={mineOnly}
        title={
          mineAvailable
            ? 'Show only the trunk and branches you have worked on recently'
            : 'Set a git user.email, or add addresses under Settings, to filter by author'
        }
        className={`px-2 py-1 rounded-sm ring-1 transition-colors disabled:opacity-40 disabled:cursor-not-allowed shrink-0 ${
          active
            ? 'bg-action/15 text-action ring-action/40'
            : 'bg-control-bg text-text-secondary ring-border-default hover:bg-control-bg-hover'
        }`}
      >
        Just mine
      </button>

      <RefreshButton onRefresh={onRefresh} refreshing={refreshing} />

      <div className="relative flex items-center min-w-0 flex-1 max-w-xs">
        <Search size={12} className="absolute left-2 text-text-muted pointer-events-none" />
        <input
          data-testid="graph-search-input"
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onStepMatch(e.shiftKey ? -1 : 1)
            if (e.key === 'Escape') onSearchChange('')
          }}
          placeholder="Search commits — author: file:"
          title="Filters the loaded commits. Use author:name, or file:path to search all history."
          className="w-full pl-7 pr-6 py-1 rounded-sm bg-control-bg ring-1 ring-border-default text-text-primary placeholder:text-text-muted focus:outline-none focus:ring-action/40"
        />
        {search && (
          <button
            data-testid="graph-search-clear"
            onClick={() => onSearchChange('')}
            title="Clear search"
            className="absolute right-1 text-text-tertiary hover:text-text-primary"
          >
            <X size={12} />
          </button>
        )}
      </div>

      {searching && (
        <>
          <span data-testid="graph-search-count" className="text-text-muted shrink-0">
            {needsHistory ? 'history only' : `${matchCount} match${matchCount === 1 ? '' : 'es'}`}
          </span>
          {matchCount > 0 && (
            <div className="flex items-center shrink-0">
              <button
                data-testid="graph-search-prev"
                onClick={() => onStepMatch(-1)}
                title="Previous match (Shift+Enter)"
                className="p-1 rounded-sm text-text-secondary hover:bg-control-bg-hover"
              >
                <ChevronUp size={12} />
              </button>
              <button
                data-testid="graph-search-next"
                onClick={() => onStepMatch(1)}
                title="Next match (Enter)"
                className="p-1 rounded-sm text-text-secondary hover:bg-control-bg-hover"
              >
                <ChevronDown size={12} />
              </button>
            </div>
          )}
          <button
            data-testid="graph-search-history"
            onClick={onSearchHistory}
            title="Search every commit in the repository, including full commit bodies — the graph only carries summaries"
            className="px-2 py-1 rounded-sm ring-1 bg-control-bg text-text-secondary ring-border-default hover:bg-control-bg-hover shrink-0"
          >
            All history
          </button>
        </>
      )}

      {active && !searching && (
        <span className="text-text-muted">trunk + branches you have worked on</span>
      )}
      <div className="ml-auto flex items-center gap-2 shrink-0">
        {onOpenWorktrees && worktreeCount > 0 && (
          <button
            data-testid="graph-worktrees-toggle"
            onClick={onOpenWorktrees}
            title="Worktrees of this repo — which branches they hold, and removing them"
            className="px-2 py-1 rounded-sm ring-1 bg-control-bg text-text-secondary ring-border-default hover:bg-control-bg-hover"
          >
            Worktrees ({worktreeCount})
          </button>
        )}
        {onOpenReflog && (
          <button
            data-testid="graph-reflog-toggle"
            onClick={onOpenReflog}
            title="Where was I? — recent HEAD movements, including commits the graph no longer shows"
            className="px-2 py-1 rounded-sm ring-1 bg-control-bg text-text-secondary ring-border-default hover:bg-control-bg-hover"
          >
            Where was I?
          </button>
        )}
        <button
          data-testid="graph-toolbar-collapse"
          onClick={onCollapse}
          aria-expanded
          title="Hide search and filters"
          className="p-1 rounded-sm text-text-tertiary hover:bg-control-bg-hover hover:text-text-primary"
        >
          <ChevronUp size={12} />
        </button>
      </div>
    </div>
  )
}

export default function GraphToolbar(props: Props) {
  const { expandedByDefault = false, mineOnly, mineAvailable, searching } = props
  const [expanded, setExpanded] = useState(expandedByDefault)

  useEffect(() => {
    setExpanded(expandedByDefault)
  }, [expandedByDefault])

  return expanded ? (
    <ExpandedToolbar {...props} onCollapse={() => setExpanded(false)} />
  ) : (
    <CollapsedToolbar
      filtered={(mineOnly && mineAvailable) || searching}
      onExpand={() => setExpanded(true)}
    />
  )
}
