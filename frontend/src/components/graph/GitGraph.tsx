import React, { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import { MoreVertical, Monitor, Cloud, Archive, Tag, GitBranch, GitPullRequest } from 'lucide-react'
import { getApiBase } from '../../config'
import { useToast } from '../../hooks/toastContext'
import { describeGitFailure } from '../../utils/gitFailure'
import type { GraphData, GraphWorktree } from '../diff/types'
import GraphToolbar from './GraphToolbar'
import { applyGraphResponse, GraphCursor } from './graphSync'
import { buildBranchMenuItems } from './branchMenu'
import { DeleteBranchModal } from './DeleteBranchModal'
import type { DeleteBranchTarget } from './branchMenu'
import { buildTagMenuItems } from './tagMenu'
import { ReflogOverlay } from './ReflogPanel'
import WorktreeOverlay from './WorktreeOverlay'
import { manageableWorktreeCount } from '../../hooks/useWorktrees'
import { readMineOnly, writeMineOnly } from '../../utils/graphMinePreference'
import { HistorySearchOverlay } from './HistorySearchPanel'
import { useGraphSearch } from './useGraphSearch'
import type { ReflogEntry } from './ReflogPanel'
import { prsByBranch, refBranchName } from './pullRequests'
import { worktreeHolding } from './worktreeBranchDelete'
import { errorDetail } from '../../utils/apiError'
import type { PullRequest } from './pullRequests'
import type { MenuBranchInfo } from './branchMenu'
import { confirmHardReset, resetMenuEntries } from './resetMenu'
import type { ResetMode } from './resetMenu'
import { computeGraphLayout, laneColor } from './graphLayout'
import { relativeDate } from '../../utils/relativeDate'
import { useClickOutside } from '../../hooks/useClickOutside'
import { useDraggablePanel } from '../../hooks/useDraggablePanel'
import {
  getSessionStatus,
  parseSessionsPayload,
  statusColorClasses,
  type SessionBase,
} from '../../utils/sessionStatus'
import dayjs from 'dayjs'

/** Live agent state for a worktree's owning session, derived for a status dot. */
function worktreeDot(session: SessionBase | undefined): { dot: string; pulse: boolean } {
  if (!session) return { dot: 'bg-text-tertiary', pulse: false }
  const status = getSessionStatus(session)
  return { dot: statusColorClasses[status.color]?.dot ?? 'bg-text-tertiary', pulse: status.pulse }
}

function WorktreeBadge({
  worktree,
  session,
}: {
  worktree: GraphWorktree
  session: SessionBase | undefined
}) {
  const { dot, pulse } = worktreeDot(session)
  const stateLabel = session ? getSessionStatus(session).label : 'No agent session'
  const title = `Worktree ${worktree.branch}${
    worktree.sessionName ? ` · ${worktree.sessionName} — ${stateLabel}` : ' · no agent'
  }${worktree.isCurrent ? ' · you are here' : ''}`
  return (
    <span
      title={title}
      className={`inline-flex items-center gap-1 shrink-0 px-1.5 py-0.5 rounded text-[11px] font-medium leading-none bg-bg-surface text-text-secondary ring-1 ${
        worktree.isCurrent ? 'ring-action' : 'ring-border-default'
      }`}
    >
      <span className={`w-2 h-2 rounded-full shrink-0 ${dot} ${pulse ? 'animate-pulse' : ''}`} />
      <GitBranch size={11} className="opacity-60 shrink-0" />
      <span className="truncate max-w-[160px]">
        {worktree.branch}
        {worktree.sessionName && <span className="text-text-muted"> · {worktree.sessionName}</span>}
      </span>
    </span>
  )
}

function TagBadge({
  name,
  isMenuOpen,
  onToggleMenu,
}: {
  name: string
  isMenuOpen: boolean
  onToggleMenu: (name: string | null, rect: DOMRect) => void
}) {
  return (
    <button
      type="button"
      title={`Tag ${name}`}
      onClick={(e) => {
        e.stopPropagation()
        onToggleMenu(isMenuOpen ? null : name, e.currentTarget.getBoundingClientRect())
      }}
      className={`inline-flex items-center gap-1 px-2 py-1 text-base rounded font-medium leading-none max-w-full ring-1 ring-slate-600/40 text-slate-400 hover:bg-slate-700/50 ${
        isMenuOpen ? 'bg-slate-700/60' : 'bg-slate-700/30'
      }`}
    >
      <Tag size={12} className="opacity-70 shrink-0" />
      <span className="truncate">{name}</span>
    </button>
  )
}

function TagContextMenu({
  menuTag,
  tagMenuRef,
  remoteTags,
  onDelete,
}: {
  menuTag: { name: string; x: number; y: number } | null
  tagMenuRef: React.RefObject<HTMLDivElement | null>
  remoteTags: Set<string> | null
  onDelete: (deleteRemote: boolean) => void
}) {
  if (!menuTag) return null
  return (
    <div
      ref={tagMenuRef}
      className="absolute z-50 w-56 py-1 bg-bg-surface border border-border-default rounded-[var(--radius-xl)] shadow-xl"
      style={{ left: menuTag.x, top: menuTag.y + 4 }}
    >
      <div className="px-3 py-1.5 text-xs text-text-muted border-b border-border-default truncate">
        <span className="font-mono font-medium text-text-secondary">{menuTag.name}</span>
      </div>
      {buildTagMenuItems(menuTag.name, remoteTags, onDelete).map((item) => (
        <button
          key={item.key}
          onClick={item.onClick}
          className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-danger/10 hover:text-danger/80"
        >
          {item.label}
        </button>
      ))}
    </div>
  )
}

function PullRequestBadge({ pr }: { pr: PullRequest }) {
  return (
    <button
      type="button"
      title={`#${pr.number} ${pr.title}${pr.isDraft ? ' (draft)' : ''}`}
      aria-label={`Open pull request #${pr.number}`}
      onClick={(e) => {
        e.stopPropagation()
        window.open(pr.url, '_blank', 'noopener,noreferrer')
      }}
      className={`inline-flex items-center justify-center p-1 rounded leading-none shrink-0 ring-1 ${
        pr.isDraft
          ? 'bg-slate-700/30 text-slate-400 ring-slate-600/40 hover:bg-slate-700/50'
          : 'bg-success/10 text-success ring-success/30 hover:bg-success/20'
      }`}
    >
      <GitPullRequest size={12} className="shrink-0" />
    </button>
  )
}

const ROW_HEIGHT = 38
const LANE_WIDTH = 28
const NODE_RADIUS = 12
const HEAD_RADIUS = 12
const SVG_PADDING_LEFT = 14
const DEFAULT_BRANCH_PANEL_WIDTH = 180
const MIN_BRANCH_PANEL_WIDTH = 80
const MAX_BRANCH_PANEL_WIDTH = 400
const branchPanelStorageKey_PREFIX = 'lumbergh:branchPanelWidth'
const DEFAULT_GRAPH_PANEL_WIDTH = 120
const MIN_GRAPH_PANEL_WIDTH = 40
const MAX_GRAPH_PANEL_WIDTH = 500
const graphPanelStorageKey_PREFIX = 'lumbergh:graphPanelWidth'
const WIP_COLOR = '#ffb74d' // orange for WIP
const STASH_COLOR = '#7c8a9e' // muted blue-gray for stash

type RefInfo = { name: string; local: boolean; remote: boolean; tag?: boolean; stash?: boolean }

function autoSelectCommit(
  data: GraphData,
  onSelect: ((hash: string | null) => void) | undefined
): void {
  if (!onSelect) return
  if (data.workingChanges) {
    onSelect(null)
  } else if (data.head?.hash) {
    onSelect(data.head.hash)
  }
}

function sortRefs(refs: RefInfo[], currentBranch: string | null | undefined): RefInfo[] {
  return [...refs].sort((a, b) => {
    if (a.name === currentBranch) return -1
    if (b.name === currentBranch) return 1
    if (a.tag !== b.tag) return a.tag ? 1 : -1
    if (a.stash !== b.stash) return a.stash ? 1 : -1
    return a.name.localeCompare(b.name)
  })
}

function computeGaps(
  labelRows: number[],
  nodeCount: number,
  totalRows: number,
  rowToY: (row: number) => number
): { y: number; count: number }[] {
  const gaps: { y: number; count: number }[] = []
  if (labelRows.length > 0 && labelRows[0] > 0) {
    const topY = rowToY(0)
    const bottomY = rowToY(labelRows[0])
    gaps.push({ y: topY + (bottomY - topY) / 2, count: labelRows[0] })
  }
  for (let i = 0; i < labelRows.length - 1; i++) {
    const count = labelRows[i + 1] - labelRows[i] - 1
    if (count > 0) {
      const topY = rowToY(labelRows[i]) + ROW_HEIGHT
      const bottomY = rowToY(labelRows[i + 1])
      gaps.push({ y: topY + (bottomY - topY) / 2, count })
    }
  }
  if (labelRows.length > 0) {
    const lastRow = labelRows[labelRows.length - 1]
    const remaining = nodeCount - lastRow - 1
    if (remaining > 0) {
      const topY = rowToY(lastRow) + ROW_HEIGHT
      const endY = totalRows * ROW_HEIGHT
      gaps.push({ y: topY + (endY - topY) / 2, count: remaining })
    }
  }
  return gaps
}

function RefBadge({
  refInfo,
  commitHash,
  commitShortHash,
  isStashMenuOpen,
  isBranchMenuOpen,
  isCurrent,
  onToggleStashMenu,
  onToggleBranchMenu,
}: {
  refInfo: RefInfo
  commitHash: string
  commitShortHash: string
  isStashMenuOpen: boolean
  isBranchMenuOpen: boolean
  isCurrent: boolean
  onToggleStashMenu: (ref: string, hash: string, rect: DOMRect) => void
  onToggleBranchMenu: (
    ref: RefInfo,
    commitHash: string,
    commitShortHash: string,
    rect: DOMRect
  ) => void
}) {
  if (refInfo.stash) {
    return (
      <button
        key={refInfo.name}
        onClick={(e) => {
          e.stopPropagation()
          const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
          if (isStashMenuOpen) {
            onToggleStashMenu('', '', rect)
          } else {
            onToggleStashMenu(refInfo.name, commitHash, rect)
          }
        }}
        className={`inline-flex items-center gap-1 px-2 py-1 text-base rounded font-medium leading-none cursor-pointer transition-colors max-w-full ${
          isStashMenuOpen
            ? 'bg-slate-500/40 text-slate-200 ring-1 ring-slate-400/70'
            : 'bg-slate-600/30 text-slate-300 ring-1 ring-slate-500/40 hover:bg-slate-500/30 hover:text-slate-200'
        }`}
      >
        <Archive size={12} className="opacity-70 shrink-0" />
        <span className="truncate">{refInfo.name}</span>
      </button>
    )
  }

  return (
    <button
      key={refInfo.name}
      onClick={(e) => {
        e.stopPropagation()
        const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
        if (isBranchMenuOpen) {
          onToggleBranchMenu(refInfo, '', '', rect)
        } else {
          onToggleBranchMenu(refInfo, commitHash, commitShortHash, rect)
        }
      }}
      className={`inline-flex items-center gap-1 px-2 py-1 text-base rounded font-medium leading-none cursor-pointer transition-colors max-w-full ${
        isBranchMenuOpen
          ? 'bg-action/40 text-action/80 ring-1 ring-action/70'
          : isCurrent
            ? 'bg-action/25 text-action ring-1 ring-action/50 hover:bg-action/35'
            : 'bg-bg-surface text-text-tertiary ring-1 ring-border-default hover:bg-control-bg-hover hover:text-text-secondary'
      }`}
    >
      <span className="truncate">{refInfo.name}</span>
      <span className="ml-auto flex items-center gap-0.5 shrink-0">
        {refInfo.local && <Monitor size={12} className="opacity-70" />}
        {refInfo.remote && <Cloud size={12} className="opacity-70" />}
      </span>
    </button>
  )
}

function getInitials(author: string, email?: string): string {
  if (author) {
    const parts = author.trim().split(/\s+/)
    if (parts.length >= 2) return (parts[0][0] + parts[1][0]).toUpperCase()
    if (parts[0].length >= 2) return parts[0].slice(0, 2).toUpperCase()
  }
  if (email) {
    const local = email.split('@')[0]
    if (local && local.length >= 2) return local.slice(0, 2).toUpperCase()
    if (local) return local[0].toUpperCase()
  }
  return '?'
}

interface Props {
  sessionName?: string
  /** `extend` is a shift-click: compare the clicked commit against the selected one. */
  onSelectCommit?: (hash: string | null, extend?: boolean) => void
  selectedCommit?: string | null
  /** The other end of a two-commit comparison, when one is active. */
  compareCommit?: string | null
  refreshTrigger?: number
  /** Bumped when the git tab is clicked — triggers auto-select of WIP or HEAD */
  resetTrigger?: number
  onGitAction?: () => void
  /** True when the git panel owns the viewport, so the toolbar can start open. */
  maximized?: boolean
}

function WipRow({
  workingChanges,
  selectedCommit,
  sessionName,
  headRow,
  branchPanelWidth,
  graphPanelWidth,
  onSelectCommit,
  afterAction,
  gitAction,
}: {
  workingChanges?: { files: number } | null
  selectedCommit?: string | null
  sessionName?: string
  headRow: number
  branchPanelWidth: number
  graphPanelWidth: number
  onSelectCommit?: (hash: string | null) => void
  afterAction: () => void
  gitAction: (url: string, options?: RequestInit) => Promise<boolean>
}) {
  if (!workingChanges) return null
  return (
    <div
      onClick={() => onSelectCommit?.(null)}
      className={`absolute right-0 flex items-center gap-2 px-1 border-b border-warning/20 cursor-pointer group ${
        selectedCommit === null
          ? 'bg-warning/20 border-l-2 border-l-warning'
          : 'bg-warning/10 hover:bg-warning/[0.16]'
      }`}
      style={{
        top: headRow * ROW_HEIGHT,
        height: ROW_HEIGHT,
        left: branchPanelWidth + graphPanelWidth + 8,
        paddingLeft: 4,
      }}
    >
      <span className="px-1.5 py-0.5 text-xs rounded font-semibold leading-none bg-warning/25 text-warning ring-1 ring-warning/50 shrink-0">
        WIP
      </span>
      <span className="text-base text-warning/90 truncate min-w-0">
        {workingChanges.files} uncommitted {workingChanges.files === 1 ? 'change' : 'changes'}
      </span>
      <button
        onClick={async (e) => {
          e.stopPropagation()
          if (!sessionName) return
          const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/stash`, {
            method: 'POST',
          })
          if (ok) afterAction()
        }}
        className="ml-auto shrink-0 p-1 rounded hover:bg-warning/25 text-warning/70 hover:text-warning/80 transition-opacity opacity-0 group-hover:opacity-100"
        title="Stash changes"
      >
        <Archive size={16} />
      </button>
    </div>
  )
}

/** What the attached worktree holds, and the acknowledgement that removing it is
 * part of the delete. Split out of the modal so each piece stays readable. */
function CommitContextMenu({
  menuCommit,
  nodes,
  rowToY,
  graphData,
  menuRef,
  handleReword,
  handleCreateBranch,
  handleCherryPick,
  handleCheckout,
  handleResetSoft,
  handleResetHard,
}: {
  menuCommit: {
    hash: string
    shortHash: string
    message: string
    pushed: boolean
    refs: { name: string; local: boolean; remote: boolean }[]
  } | null
  nodes: ReturnType<typeof computeGraphLayout>
  rowToY: (row: number) => number
  graphData: GraphData | null
  menuRef: React.RefObject<HTMLDivElement | null>
  handleReword: () => void
  handleCreateBranch: () => void
  handleCherryPick: () => void
  handleCheckout: (branchName: string, ref: { local: boolean; remote: boolean }) => void
  handleResetSoft: () => void
  handleResetHard: () => void
}) {
  if (!menuCommit) return null
  const menuRow = nodes.findIndex((n) => n.commit.hash === menuCommit.hash)
  if (menuRow === -1) return null
  const topPx = rowToY(menuRow) + ROW_HEIGHT
  return (
    <div
      ref={menuRef}
      className="absolute right-2 z-50 w-52 py-1 bg-bg-surface border border-border-default rounded-[var(--radius-xl)] shadow-xl"
      style={{ top: topPx }}
    >
      {!menuCommit.pushed && (
        <>
          <button
            onClick={handleReword}
            className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-control-bg-hover hover:text-text-primary"
          >
            Edit commit message...
          </button>
          <div className="mx-2 my-1 border-t border-border-default" />
        </>
      )}
      <button
        onClick={handleCreateBranch}
        className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-control-bg-hover hover:text-text-primary"
      >
        Create branch here...
      </button>
      <button
        onClick={handleCherryPick}
        className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-control-bg-hover hover:text-text-primary"
      >
        Cherry-pick this commit
      </button>
      {menuCommit.refs
        .filter((r) => r.name !== graphData?.head?.branch)
        .map((r) => (
          <button
            key={r.name}
            onClick={() => handleCheckout(r.name, r)}
            className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-control-bg-hover hover:text-text-primary"
          >
            Checkout <span className="font-mono text-text-primary">{r.name}</span>
          </button>
        ))}
      <div className="mx-2 my-1 border-t border-border-default" />
      {resetMenuEntries(handleResetHard, handleResetSoft).map((entry) => (
        <button
          key={entry.key}
          onClick={entry.onClick}
          className={
            entry.danger
              ? 'w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-danger/10 hover:text-danger/80'
              : 'w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-control-bg-hover hover:text-text-primary'
          }
        >
          {entry.label}
        </button>
      ))}
    </div>
  )
}

function StashContextMenu({
  menuStash,
  stashMenuRef,
  handleStashPop,
  handleStashDrop,
}: {
  menuStash: { ref: string; hash: string; x: number; y: number } | null
  stashMenuRef: React.RefObject<HTMLDivElement | null>
  handleStashPop: () => void
  handleStashDrop: () => void
}) {
  if (!menuStash) return null
  return (
    <div
      ref={stashMenuRef}
      className="absolute z-50 w-48 py-1 bg-bg-surface border border-border-default rounded-[var(--radius-xl)] shadow-xl"
      style={{ left: menuStash.x, top: menuStash.y + 4 }}
    >
      <div className="px-3 py-1.5 text-xs text-text-muted border-b border-border-default truncate">
        <span className="font-mono font-medium text-text-secondary">{menuStash.ref}</span>
      </div>
      <button
        onClick={handleStashPop}
        className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-control-bg-hover hover:text-text-primary"
      >
        Pop
      </button>
      <button
        onClick={handleStashDrop}
        className="w-full text-left px-3 py-1.5 text-sm text-danger hover:bg-danger/10 hover:text-danger/80"
      >
        Delete
      </button>
    </div>
  )
}

function BranchContextMenu({
  menuBranch,
  branchMenuRef,
  graphData,
  handleBranchCheckout,
  handleBranchPush,
  handleResetTo,
  setDeleteBranchConfirm,
  setMenuBranch,
}: {
  menuBranch: MenuBranchInfo | null
  branchMenuRef: React.RefObject<HTMLDivElement | null>
  graphData: GraphData | null
  handleBranchCheckout: () => void
  handleBranchPush: () => void
  handleResetTo: (hash: string, mode: ResetMode) => void
  setDeleteBranchConfirm: (v: DeleteBranchTarget | null) => void
  setMenuBranch: (v: MenuBranchInfo | null) => void
}) {
  if (!menuBranch) return null
  const isCurrent = graphData?.head?.branch === menuBranch.name
  const hasUnpushed = isCurrent && graphData?.commits.some((c) => c.pushed === false)
  const items = buildBranchMenuItems(
    menuBranch,
    isCurrent,
    hasUnpushed,
    handleBranchCheckout,
    handleBranchPush,
    handleResetTo,
    setDeleteBranchConfirm,
    setMenuBranch,
    worktreeHolding(menuBranch.name, graphData?.worktrees)
  )

  return (
    <div
      ref={branchMenuRef}
      className="absolute z-50 w-52 py-1 bg-bg-surface border border-border-default rounded-[var(--radius-xl)] shadow-xl"
      style={{ left: menuBranch.x, top: menuBranch.y + 4 }}
    >
      <div className="px-3 py-1.5 text-xs text-text-muted border-b border-border-default truncate">
        <span className="font-mono font-medium text-text-secondary">{menuBranch.name}</span>
      </div>
      {items.map((item) => (
        <React.Fragment key={item.key}>
          {item.separator && <div className="mx-2 my-1 border-t border-border-default" />}
          <button
            onClick={item.onClick}
            className={`w-full text-left px-3 py-1.5 text-sm ${
              item.danger
                ? 'text-danger hover:bg-danger/10 hover:text-danger/80 flex items-center gap-2'
                : 'text-text-secondary hover:bg-control-bg-hover hover:text-text-primary'
            }`}
          >
            {item.label}
          </button>
        </React.Fragment>
      ))}
    </div>
  )
}

function storageKeyFor(prefix: string, sessionName?: string): string {
  return sessionName ? `${prefix}:${sessionName}` : prefix
}

export default function GitGraph({
  sessionName,
  onSelectCommit,
  selectedCommit,
  compareCommit,
  refreshTrigger,
  resetTrigger,
  onGitAction,
  maximized,
}: Props) {
  const branchPanelStorageKey = storageKeyFor(branchPanelStorageKey_PREFIX, sessionName)
  const graphPanelStorageKey = storageKeyFor(graphPanelStorageKey_PREFIX, sessionName)
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [sessions, setSessions] = useState<SessionBase[]>([])
  const [loading, setLoading] = useState(false)
  const [refreshing, setRefreshing] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commitLimit, setCommitLimit] = useState(100)
  const [mineOnly, setMineOnly] = useState(readMineOnly)
  const [menuCommit, setMenuCommit] = useState<{
    hash: string
    shortHash: string
    message: string
    pushed: boolean
    refs: { name: string; local: boolean; remote: boolean }[]
  } | null>(null)
  const [menuBranch, setMenuBranch] = useState<MenuBranchInfo | null>(null)
  const [menuStash, setMenuStash] = useState<{
    ref: string
    hash: string
    x: number
    y: number
  } | null>(null)
  const [menuTag, setMenuTag] = useState<{ name: string; x: number; y: number } | null>(null)
  const [remoteTags, setRemoteTags] = useState<Set<string> | null>(null)
  const [showReflog, setShowReflog] = useState(false)
  const [showWorktrees, setShowWorktrees] = useState(false)
  const [pullRequests, setPullRequests] = useState<Map<string, PullRequest>>(new Map())
  const [deleteBranchConfirm, setDeleteBranchConfirm] = useState<DeleteBranchTarget | null>(null)
  const [expandedRow, setExpandedRow] = useState<number | null>(null)
  const expandedRowTimeout = useRef<ReturnType<typeof setTimeout> | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)
  const branchMenuRef = useRef<HTMLDivElement>(null)
  const stashMenuRef = useRef<HTMLDivElement>(null)
  const tagMenuRef = useRef<HTMLDivElement>(null)
  const didAutoSelect = useRef(false)
  const didAutoScroll = useRef(false)
  const onSelectCommitRef = useRef(onSelectCommit)
  onSelectCommitRef.current = onSelectCommit

  // Draggable panel hooks
  const branchPanel = useDraggablePanel({
    storageKey: branchPanelStorageKey,
    defaultWidth: DEFAULT_BRANCH_PANEL_WIDTH,
    minWidth: MIN_BRANCH_PANEL_WIDTH,
    maxWidth: MAX_BRANCH_PANEL_WIDTH,
  })
  const graphPanel = useDraggablePanel({
    storageKey: graphPanelStorageKey,
    defaultWidth: DEFAULT_GRAPH_PANEL_WIDTH,
    minWidth: MIN_GRAPH_PANEL_WIDTH,
    maxWidth: MAX_GRAPH_PANEL_WIDTH,
  })

  // Fetch configured commit limit from settings
  useEffect(() => {
    fetch(`${getApiBase()}/settings`)
      .then((r) => r.json())
      .then((s) => {
        if (s.gitGraphCommits) setCommitLimit(s.gitGraphCommits)
      })
      .catch(() => {})
  }, [])

  // Poll live session state to overlay agent status on worktree badges. This is
  // deliberately client-side — the cached graph payload carries only structural
  // worktree data, so live state never goes stale in the cache.
  useEffect(() => {
    let cancelled = false
    const load = () => {
      fetch(`${getApiBase()}/sessions`)
        .then((r) => r.json())
        .then((data) => {
          if (!cancelled) setSessions(parseSessionsPayload(data))
        })
        .catch(() => {})
    }
    load()
    const interval = setInterval(load, 5000)
    return () => {
      cancelled = true
      clearInterval(interval)
    }
  }, [])

  const sessionsByName = useMemo(() => {
    const map = new Map<string, SessionBase>()
    for (const s of sessions) map.set(s.name, s)
    return map
  }, [sessions])

  const worktreeByShortHash = useMemo(() => {
    const map = new Map<string, GraphWorktree>()
    for (const wt of graphData?.worktrees ?? []) {
      if (!map.has(wt.headHash)) map.set(wt.headHash, wt)
    }
    return map
  }, [graphData])

  const cursorRef = useRef(new GraphCursor())
  const graphDataRef = useRef<GraphData | null>(null)
  graphDataRef.current = graphData

  const fetchGraph = useCallback(async () => {
    if (!sessionName) return
    try {
      const cursor = cursorRef.current
      const res = await fetch(
        `${getApiBase()}/sessions/${sessionName}/git/graph?limit=${commitLimit}&mine=${mineOnly}${cursor.sinceParam()}`,
        { headers: cursor.headers() }
      )
      if (res.status === 304) return // Not modified
      if (!res.ok) throw new Error(await errorDetail(res))

      const { graph, cursorValid } = applyGraphResponse(graphDataRef.current, await res.json())
      cursor.advance(res.headers.get('etag'), graph?.version, cursorValid)
      setError(null)
      setLoading(false)
      if (!graph) return
      setGraphData(graph)
      if (!didAutoSelect.current) {
        didAutoSelect.current = true
        autoSelectCommit(graph, onSelectCommitRef.current)
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch graph')
      setLoading(false)
    }
  }, [sessionName, commitLimit, mineOnly])

  /**
   * Drop every cached copy of the graph — the backend's and this page's — and
   * draw it again. Polling cannot recover a wedged view on its own: each poll
   * offers the tokens that let the server answer "nothing new", and those are
   * exactly what a wedged view needs to stop sending.
   */
  const refreshGraph = useCallback(async () => {
    setRefreshing(true)
    try {
      await fetch(`${getApiBase()}/sessions/${sessionName}/git/invalidate`, {
        method: 'POST',
      }).catch(() => {})
      cursorRef.current.reset()
      await fetchGraph()
    } finally {
      setRefreshing(false)
    }
  }, [sessionName, fetchGraph])

  const toggleMineOnly = useCallback(() => {
    setMineOnly((on) => {
      const next = !on
      writeMineOnly(next)
      return next
    })
  }, [])

  // A cursor only describes one shape of payload. Changing session, limit or
  // filter makes it meaningless, so drop it and take a fresh keyframe. Declared
  // above the polling effect so it runs before the next fetch.
  useEffect(() => {
    cursorRef.current.reset()
  }, [sessionName, commitLimit, mineOnly])

  // Fetch on mount + poll every 5s (matches diff polling cadence)
  // Also re-fetch when refreshTrigger bumps (after git actions)
  useEffect(() => {
    fetchGraph()
    const interval = setInterval(fetchGraph, 5000)
    return () => clearInterval(interval)
  }, [fetchGraph, refreshTrigger])

  // Re-run auto-select when resetTrigger bumps (git tab clicked while already visible)
  // (scrollToActive called in a separate effect below, after nodes/rowToY are defined)
  const prevResetTrigger = useRef(resetTrigger)
  const resetTriggerFired = useRef(false)
  useEffect(() => {
    if (resetTrigger !== prevResetTrigger.current) {
      prevResetTrigger.current = resetTrigger
      resetTriggerFired.current = true
      if (graphData) {
        autoSelectCommit(graphData, onSelectCommit)
      }
    }
  }, [resetTrigger, graphData, onSelectCommit])

  // Close menus on click-outside or Escape
  const closeCommitMenu = useCallback(() => setMenuCommit(null), [])
  const closeBranchMenu = useCallback(() => setMenuBranch(null), [])
  const closeStashMenu = useCallback(() => setMenuStash(null), [])
  const closeTagMenu = useCallback(() => setMenuTag(null), [])

  useClickOutside(menuRef, !!menuCommit, closeCommitMenu)
  useClickOutside(branchMenuRef, !!menuBranch, closeBranchMenu)
  useClickOutside(stashMenuRef, !!menuStash, closeStashMenu)
  useClickOutside(tagMenuRef, !!menuTag, closeTagMenu)

  const afterAction = useCallback(() => {
    setMenuCommit(null)
    fetchGraph()
    onGitAction?.()
  }, [fetchGraph, onGitAction])

  const toast = useToast()
  const gitAction = useCallback(
    async (url: string, options?: RequestInit) => {
      try {
        const res = await fetch(url, options)
        if (!res.ok) {
          const data = await res.json().catch(() => ({}))
          const { message, detail } = describeGitFailure(data.detail, res.status)
          toast.error(message, detail)
          return false
        }
        return true
      } catch {
        toast.error('Could not reach the server')
        return false
      }
    },
    [toast]
  )

  const handleCreateBranch = useCallback(async () => {
    if (!menuCommit || !sessionName) return
    const name = prompt('Branch name:')
    if (!name) return
    const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/create-branch`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, start_point: menuCommit.hash }),
    })
    if (ok) afterAction()
  }, [sessionName, menuCommit, afterAction, gitAction])

  const handleResetSoft = useCallback(async () => {
    if (!menuCommit || !sessionName) return
    const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/reset-to`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: menuCommit.hash, mode: 'soft' }),
    })
    if (ok) afterAction()
  }, [sessionName, menuCommit, afterAction, gitAction])

  const handleResetHard = useCallback(async () => {
    if (!menuCommit || !sessionName) return
    if (!confirmHardReset(menuCommit.shortHash)) return
    const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/reset-to`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: menuCommit.hash, mode: 'hard' }),
    })
    if (ok) afterAction()
  }, [sessionName, menuCommit, afterAction, gitAction])

  const handleResetTo = useCallback(
    async (hash: string, mode: ResetMode) => {
      if (!sessionName) return
      const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/reset-to`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash, mode }),
      })
      if (ok) {
        setMenuBranch(null)
        afterAction()
      }
    },
    [sessionName, afterAction, gitAction]
  )

  const handleReword = useCallback(async () => {
    if (!menuCommit || !sessionName) return
    const newMessage = prompt('Edit commit message:', menuCommit.message)
    if (newMessage === null || newMessage === menuCommit.message) return
    const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/reword`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: menuCommit.hash, message: newMessage }),
    })
    if (ok) afterAction()
  }, [sessionName, menuCommit, afterAction, gitAction])

  const handleCherryPick = useCallback(async () => {
    if (!menuCommit || !sessionName) return
    const confirmed = confirm(
      `Cherry-pick commit ${menuCommit.shortHash} onto current branch?\n\n"${menuCommit.message}"`
    )
    if (!confirmed) return
    const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/cherry-pick`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ hash: menuCommit.hash }),
    })
    if (ok) afterAction()
  }, [sessionName, menuCommit, afterAction, gitAction])

  const handleCheckout = useCallback(
    async (branchName: string, ref: { local: boolean; remote: boolean }) => {
      if (!sessionName || !menuCommit) return

      if (!ref.local && ref.remote) {
        const confirmed = confirm(
          `"${branchName}" exists locally at a different commit.\n\nCheckout and reset it to ${menuCommit.shortHash}?`
        )
        if (!confirmed) return
      }

      const body: { branch: string; reset_to?: string } = { branch: branchName }
      if (!ref.local && ref.remote) {
        body.reset_to = menuCommit.hash
      }

      const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/checkout`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      if (ok) afterAction()
    },
    [sessionName, menuCommit, afterAction, gitAction]
  )

  const handleBranchCheckout = useCallback(async () => {
    if (!sessionName || !menuBranch) return

    if (!menuBranch.local && menuBranch.remote) {
      const confirmed = confirm(
        `"${menuBranch.name}" exists locally at a different commit.\n\nCheckout and reset it to ${menuBranch.commitShortHash}?`
      )
      if (!confirmed) return
    }

    const body: { branch: string; reset_to?: string } = { branch: menuBranch.name }
    if (!menuBranch.local && menuBranch.remote) {
      body.reset_to = menuBranch.commitHash
    }

    const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/checkout`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (ok) {
      setMenuBranch(null)
      afterAction()
    }
  }, [sessionName, menuBranch, afterAction, gitAction])

  const handleBranchPush = useCallback(async () => {
    if (!sessionName || !menuBranch) return
    const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/push`, {
      method: 'POST',
    })
    if (ok) {
      setMenuBranch(null)
      afterAction()
    }
  }, [sessionName, menuBranch, afterAction, gitAction])

  const handleStashPop = useCallback(async () => {
    if (!sessionName || !menuStash) return
    const ok = await gitAction(
      `${getApiBase()}/sessions/${sessionName}/git/stash-pop?ref=${encodeURIComponent(menuStash.ref)}`,
      { method: 'POST' }
    )
    if (ok) {
      setMenuStash(null)
      afterAction()
    }
  }, [sessionName, menuStash, afterAction, gitAction])

  /** Open PRs, if `gh` can see any. Absent for a non-GitHub repo, and never
   * worth an error: the badges just do not appear. */
  useEffect(() => {
    if (!sessionName) return
    let cancelled = false
    ;(async () => {
      try {
        const res = await fetch(`${getApiBase()}/sessions/${sessionName}/git/pull-requests`)
        if (!res.ok) return
        const data = await res.json()
        if (!cancelled) setPullRequests(prsByBranch(data.prs ?? []))
      } catch {
        // No gh, no network, no badges.
      }
    })()
    return () => {
      cancelled = true
    }
  }, [sessionName, refreshTrigger])

  /** Ask origin which tags it has — one network round trip, on demand, kept for
   * the rest of the session unless a delete changes the answer. */
  const ensureRemoteTags = useCallback(async () => {
    if (!sessionName || remoteTags) return
    try {
      const res = await fetch(`${getApiBase()}/sessions/${sessionName}/git/remote-tags`)
      if (!res.ok) return
      const data = await res.json()
      setRemoteTags(new Set<string>(data.tags ?? []))
    } catch {
      // No origin, no network, no problem: the menu just offers the local delete.
    }
  }, [sessionName, remoteTags])

  const openReflog = useCallback(() => setShowReflog(true), [])
  const openWorktrees = useCallback(() => setShowWorktrees(true), [])
  const closeWorktrees = useCallback(() => setShowWorktrees(false), [])
  const worktreeCount = manageableWorktreeCount(graphData)
  const closeReflog = useCallback(() => setShowReflog(false), [])

  const handleBranchFromReflog = useCallback(
    async (entry: ReflogEntry) => {
      if (!sessionName) return
      const suggested = `recover/${entry.shortHash}`
      const name = prompt(`Branch name for ${entry.shortHash} (${entry.message})`, suggested)
      if (!name) return
      const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/create-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, start_point: entry.hash }),
      })
      if (!ok) return
      setShowReflog(false)
      afterAction()
    },
    [sessionName, afterAction, gitAction]
  )

  const handleResetFromReflog = useCallback(
    async (entry: ReflogEntry) => {
      if (!sessionName) return
      if (!confirmHardReset(`${entry.shortHash} (${entry.selector})`)) return
      const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/reset-to`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: entry.hash, mode: 'hard' }),
      })
      if (!ok) return
      setShowReflog(false)
      afterAction()
    },
    [sessionName, afterAction, gitAction]
  )

  const handleDeleteTag = useCallback(
    async (deleteRemote: boolean) => {
      if (!sessionName || !menuTag) return
      const ok = await gitAction(`${getApiBase()}/sessions/${sessionName}/git/delete-tag`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ tag: menuTag.name, delete_remote: deleteRemote }),
      })
      if (!ok) return
      if (deleteRemote) setRemoteTags(null)
      setMenuTag(null)
      afterAction()
    },
    [sessionName, menuTag, afterAction, gitAction]
  )

  const handleStashDrop = useCallback(async () => {
    if (!sessionName || !menuStash) return
    const ok = await gitAction(
      `${getApiBase()}/sessions/${sessionName}/git/stash-drop?ref=${encodeURIComponent(menuStash.ref)}`,
      { method: 'POST' }
    )
    if (ok) {
      setMenuStash(null)
      afterAction()
    }
  }, [sessionName, menuStash, afterAction, gitAction])

  const nodes = useMemo(() => {
    if (!graphData) return []
    return computeGraphLayout(graphData.commits, graphData.head?.hash ?? null)
  }, [graphData])

  // The block of rows a two-commit comparison spans, so the diff below has a
  // visible extent in the graph rather than two disconnected highlights.
  const comparedRows = useMemo(() => {
    if (!selectedCommit || !compareCommit) return null
    const anchor = nodes.findIndex((n) => n.commit.hash === selectedCommit)
    const other = nodes.findIndex((n) => n.commit.hash === compareCommit)
    if (anchor === -1 || other === -1) return null
    return { first: Math.min(anchor, other), last: Math.max(anchor, other) }
  }, [nodes, selectedCommit, compareCommit])

  // Worktrees whose HEAD is older than the commit limit aren't drawn on the graph —
  // surface them in a strip so they don't silently vanish.
  const offscreenWorktrees = useMemo(() => {
    const visible = new Set(nodes.map((n) => n.commit.shortHash))
    return (graphData?.worktrees ?? []).filter((wt) => !wt.isMain && !visible.has(wt.headHash))
  }, [graphData, nodes])

  const hasWip = graphData?.workingChanges != null
  // Find which row HEAD is on so we can insert WIP right above it
  const headRow = useMemo(() => {
    const idx = nodes.findIndex((n) => n.isHead)
    return idx >= 0 ? idx : 0
  }, [nodes])
  // Helper: map a commit row index to its pixel position, accounting for WIP insertion
  const rowToY = useCallback(
    (row: number) => {
      if (!hasWip) return row * ROW_HEIGHT
      // Rows before HEAD are unshifted; HEAD and after shift down by 1 to make room for WIP
      return row < headRow ? row * ROW_HEIGHT : (row + 1) * ROW_HEIGHT
    },
    [hasWip, headRow]
  )

  const maxLane = useMemo(() => {
    let max = 0
    for (const n of nodes) {
      if (n.lane > max) max = n.lane
      for (const e of n.edges) {
        if (e.toLane > max) max = e.toLane
        if (e.fromLane > max) max = e.fromLane
      }
    }
    return max
  }, [nodes])

  const svgWidth = SVG_PADDING_LEFT + (maxLane + 1) * LANE_WIDTH + 8
  const totalRows = nodes.length + (hasWip ? 1 : 0)

  // Find the lane HEAD lives on (for highlighting the current branch lane)
  const headLane = useMemo(() => {
    const headNode = nodes.find((n) => n.isHead)
    return headNode?.lane ?? 0
  }, [nodes])

  // Scroll to WIP/HEAD — on first data load and when resetTrigger fires
  const scrollToActive = useCallback(() => {
    if (!containerRef.current || !graphData) return
    const headIdx = nodes.findIndex((n) => n.isHead)
    if (headIdx === -1) return
    const targetY = graphData.workingChanges ? headIdx * ROW_HEIGHT : rowToY(headIdx)
    const container = containerRef.current
    container.scrollTop = Math.max(0, targetY - container.clientHeight / 2 + ROW_HEIGHT / 2)
  }, [graphData, nodes, rowToY])

  useEffect(() => {
    if (!didAutoScroll.current && nodes.length > 0 && graphData) {
      didAutoScroll.current = true
      scrollToActive()
    }
  }, [nodes, graphData, scrollToActive])

  useEffect(() => {
    if (resetTriggerFired.current) {
      resetTriggerFired.current = false
      scrollToActive()
    }
  }, [resetTrigger, scrollToActive])

  const {
    search,
    setSearch,
    query,
    searching,
    matchCount,
    loadedHashes,
    dimOpacity,
    stepMatch,
    showHistorySearch,
    openHistorySearch,
    closeHistorySearch,
  } = useGraphSearch({
    graphData,
    nodes,
    rowToY,
    rowHeight: ROW_HEIGHT,
    containerRef,
    onSelectCommit,
  })

  // Compute branch label positions for left panel
  const branchEntries = useMemo(() => {
    const labels: { row: number; refs: RefInfo[] }[] = []
    const currentBranch = graphData?.head?.branch
    for (let row = 0; row < nodes.length; row++) {
      if (nodes[row].commit.refs.length > 0) {
        labels.push({ row, refs: sortRefs(nodes[row].commit.refs, currentBranch) })
      }
    }
    const labelRows = labels.map((l) => l.row)
    const gaps = computeGaps(labelRows, nodes.length, totalRows, rowToY)
    return { labels, gaps }
  }, [nodes, rowToY, totalRows, graphData])

  // Day separator positions — shows label at the first commit of each new day
  const daySeparators = useMemo(() => {
    const seps: { row: number; label: string }[] = []
    let prevDay = ''
    const today = dayjs().startOf('day')
    const yesterday = today.subtract(1, 'day')
    for (let row = 0; row < nodes.length; row++) {
      const d = dayjs(nodes[row].commit.relativeDate)
      const day = d.format('YYYY-MM-DD')
      if (day !== prevDay) {
        prevDay = day
        let label: string
        if (d.isSame(today, 'day')) {
          label = 'Today'
        } else if (d.isSame(yesterday, 'day')) {
          label = 'Yesterday'
        } else if (d.isAfter(today.subtract(7, 'day'))) {
          label = d.format('dddd') // e.g. "Monday"
        } else if (d.year() === today.year()) {
          label = d.format('MMM D') // e.g. "Feb 28"
        } else {
          label = d.format('MMM D, YYYY')
        }
        seps.push({ row, label })
      }
    }
    return seps
  }, [nodes])

  const renderWipSvg = () => {
    if (!hasWip) return null
    const cx = SVG_PADDING_LEFT + headLane * LANE_WIDTH + LANE_WIDTH / 2
    const wipY = headRow * ROW_HEIGHT + ROW_HEIGHT / 2 // WIP sits at headRow position
    const headY = (headRow + 1) * ROW_HEIGHT + ROW_HEIGHT / 2 // HEAD shifts down by 1

    return (
      <g>
        {/* Dashed line from WIP down to HEAD */}
        <line
          x1={cx}
          y1={wipY}
          x2={cx}
          y2={headY}
          stroke={WIP_COLOR}
          strokeWidth={2}
          strokeDasharray="4 3"
          strokeOpacity={0.7}
        />
        {/* WIP dot — dashed circle */}
        <circle
          cx={cx}
          cy={wipY}
          r={HEAD_RADIUS + 1}
          fill="none"
          stroke={WIP_COLOR}
          strokeWidth={2}
          strokeDasharray="3 2"
        />
        <circle cx={cx} cy={wipY} r={3} fill={WIP_COLOR} />
      </g>
    )
  }

  const renderEdges = () => {
    const lines: React.ReactElement[] = []
    for (const node of nodes) {
      for (let ei = 0; ei < node.edges.length; ei++) {
        const e = node.edges[ei]
        const x1 = SVG_PADDING_LEFT + e.fromLane * LANE_WIDTH + LANE_WIDTH / 2
        const y1 = rowToY(e.fromRow) + ROW_HEIGHT / 2
        const x2 = SVG_PADDING_LEFT + e.toLane * LANE_WIDTH + LANE_WIDTH / 2
        const y2 = rowToY(e.toRow) + ROW_HEIGHT / 2
        const color = laneColor(e.fromLane)
        const key = `${node.commit.shortHash}-${ei}`
        const isCurrentBranchEdge =
          node.onCurrentBranch && e.fromLane === headLane && e.toLane === headLane
        const opacity = isCurrentBranchEdge ? 1 : 0.4
        const width = isCurrentBranchEdge ? 2.5 : 1.5

        if (e.fromLane === e.toLane) {
          lines.push(
            <line
              key={key}
              x1={x1}
              y1={y1}
              x2={x2}
              y2={y2}
              stroke={color}
              strokeWidth={width}
              strokeOpacity={opacity}
            />
          )
        } else {
          // L-shaped: vertical in child's lane, rounded corner, horizontal to parent's lane
          const maxR = 10
          const r = Math.min(maxR, Math.abs(y2 - y1) / 2, Math.abs(x2 - x1) / 2)
          const dx = x2 > x1 ? r : -r
          lines.push(
            <path
              key={key}
              d={`M ${x1} ${y1} L ${x1} ${y2 - r} Q ${x1} ${y2} ${x1 + dx} ${y2} L ${x2} ${y2}`}
              stroke={color}
              strokeWidth={width}
              strokeOpacity={opacity}
              fill="none"
            />
          )
        }
      }
    }
    return lines
  }

  const renderNodes = () => {
    return nodes.map((node, row) => {
      const cx = SVG_PADDING_LEFT + node.lane * LANE_WIDTH + LANE_WIDTH / 2
      const cy = rowToY(row) + ROW_HEIGHT / 2
      const color = laneColor(node.lane)
      const initials = getInitials(node.commit.author, node.commit.authorEmail)
      const clipId = `clip-${node.commit.hash}`
      const r = NODE_RADIUS
      const opacity = node.onCurrentBranch ? 1 : 0.7
      const dim = dimOpacity(node.commit.hash)

      const avatarGroup = (
        <>
          {/* Background circle with lane color */}
          <circle cx={cx} cy={cy} r={r} fill={color} />
          {/* Initials text (visible when no gravatar) */}
          <text
            x={cx}
            y={cy}
            textAnchor="middle"
            dominantBaseline="central"
            fill="white"
            fontSize="10"
            fontWeight="bold"
            fontFamily="system-ui, sans-serif"
            style={{ pointerEvents: 'none' }}
          >
            {initials}
          </text>
          {/* Clip path for gravatar */}
          <defs>
            <clipPath id={clipId}>
              <circle cx={cx} cy={cy} r={r} />
            </clipPath>
          </defs>
          {/* Gravatar image (transparent if missing, so initials show through) */}
          {node.commit.authorGravatar && (
            <image
              href={node.commit.authorGravatar}
              x={cx - r}
              y={cy - r}
              width={r * 2}
              height={r * 2}
              clipPath={`url(#${clipId})`}
              style={{ pointerEvents: 'none' }}
            />
          )}
          {/* Border ring */}
          <circle cx={cx} cy={cy} r={r} fill="none" stroke={color} strokeWidth={1.5} />
        </>
      )

      // Stash nodes get a distinctive box icon instead of avatar
      if (node.commit.stash) {
        const stashR = r - 2
        return (
          <g key={node.commit.hash} opacity={0.8 * dim}>
            {/* Rounded rect background */}
            <rect
              x={cx - stashR}
              y={cy - stashR}
              width={stashR * 2}
              height={stashR * 2}
              rx={3}
              fill={STASH_COLOR}
              stroke={STASH_COLOR}
              strokeWidth={1.5}
            />
            {/* Archive/box icon lines */}
            <line
              x1={cx - 5}
              y1={cy - 3}
              x2={cx + 5}
              y2={cy - 3}
              stroke="white"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            <line
              x1={cx - 3}
              y1={cy + 1}
              x2={cx + 3}
              y2={cy + 1}
              stroke="white"
              strokeWidth={1.5}
              strokeLinecap="round"
            />
            <rect
              x={cx - 5}
              y={cy - 5}
              width={10}
              height={10}
              rx={1.5}
              fill="none"
              stroke="white"
              strokeWidth={1.2}
            />
          </g>
        )
      }

      if (node.isHead) {
        return (
          <g key={node.commit.hash} opacity={dim}>
            {/* Outer ring */}
            <circle
              cx={cx}
              cy={cy}
              r={r + 3}
              fill="none"
              stroke={color}
              strokeWidth={2}
              opacity={0.6}
            />
            {/* Avatar */}
            {avatarGroup}
          </g>
        )
      }
      return (
        <g key={node.commit.hash} opacity={opacity * dim}>
          {avatarGroup}
        </g>
      )
    })
  }

  if (!sessionName) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        No session selected
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col relative">
      {/* Error */}
      {error && <div className="px-3 py-2 text-sm text-danger bg-danger/10">{error}</div>}

      <GraphToolbar
        mineOnly={mineOnly}
        mineAvailable={graphData?.mine?.available ?? true}
        onToggleMineOnly={toggleMineOnly}
        onRefresh={refreshGraph}
        refreshing={refreshing}
        onOpenReflog={sessionName ? openReflog : undefined}
        onOpenWorktrees={openWorktrees}
        worktreeCount={worktreeCount}
        search={search}
        onSearchChange={setSearch}
        matchCount={matchCount}
        searching={searching}
        needsHistory={query.needsHistory}
        onStepMatch={stepMatch}
        onSearchHistory={openHistorySearch}
        expandedByDefault={maximized}
      />

      <WorktreeOverlay open={showWorktrees} sessionName={sessionName} onClose={closeWorktrees} />

      <ReflogOverlay
        open={showReflog}
        sessionName={sessionName}
        onClose={closeReflog}
        onBranchFrom={handleBranchFromReflog}
        onResetTo={handleResetFromReflog}
      />

      <HistorySearchOverlay
        open={showHistorySearch}
        sessionName={sessionName}
        query={query}
        loadedHashes={loadedHashes}
        onClose={closeHistorySearch}
        onSelectCommit={(hash) => {
          onSelectCommit?.(hash)
          closeHistorySearch()
        }}
      />

      {/* Off-screen worktrees — HEADs older than the commit limit */}
      {offscreenWorktrees.length > 0 && (
        <div className="flex items-center gap-2 px-3 py-1.5 text-xs border-b border-border-default bg-bg-surface/50 overflow-x-auto">
          <span className="text-text-muted shrink-0">Off-screen worktrees:</span>
          {offscreenWorktrees.map((wt) => (
            <button
              key={wt.path}
              onClick={() => setCommitLimit((n) => n + 200)}
              title="Load more commits to reveal this worktree on the graph"
              className="shrink-0"
            >
              <WorktreeBadge
                worktree={wt}
                session={wt.sessionName ? sessionsByName.get(wt.sessionName) : undefined}
              />
            </button>
          ))}
        </div>
      )}

      {/* Graph */}
      <div ref={containerRef} className="flex-1 min-h-0 overflow-auto">
        {nodes.length === 0 && !loading && !error ? (
          <div className="flex items-center justify-center h-full text-text-muted text-sm">
            No commits found
          </div>
        ) : (
          <div className="relative" style={{ height: totalRows * ROW_HEIGHT }}>
            {/* Branch panel - left column */}
            <div
              className="absolute top-0 left-0 bottom-0 border-r border-border-default/50"
              style={{ width: branchPanel.width }}
            >
              {branchEntries.labels.map(({ row, refs }) => {
                const primaryRef = refs[0]
                const extraCount = refs.length - 1
                const isExpanded = expandedRow === row
                const commit = nodes[row].commit

                const renderRefBadge = (ref: RefInfo) => {
                  const pr = pullRequests.get(refBranchName(ref.name))
                  return pr ? (
                    <span
                      key={ref.name}
                      className="inline-flex items-center gap-1 min-w-0 max-w-full"
                    >
                      <span className="flex min-w-0">{renderBadge(ref)}</span>
                      <PullRequestBadge pr={pr} />
                    </span>
                  ) : (
                    renderBadge(ref)
                  )
                }

                const renderBadge = (ref: RefInfo) =>
                  ref.tag ? (
                    <TagBadge
                      key={ref.name}
                      name={ref.name}
                      isMenuOpen={menuTag?.name === ref.name}
                      onToggleMenu={(tagName, rect) => {
                        if (!tagName) {
                          setMenuTag(null)
                          return
                        }
                        const containerRect = containerRef.current?.getBoundingClientRect()
                        setMenuTag({
                          name: tagName,
                          x: rect.left - (containerRect?.left ?? 0),
                          y:
                            rect.bottom -
                            (containerRect?.top ?? 0) +
                            (containerRef.current?.scrollTop ?? 0),
                        })
                        setMenuCommit(null)
                        setMenuBranch(null)
                        setMenuStash(null)
                        ensureRemoteTags()
                      }}
                    />
                  ) : (
                    <RefBadge
                      key={ref.name}
                      refInfo={ref}
                      commitHash={commit.hash}
                      commitShortHash={commit.shortHash}
                      isStashMenuOpen={
                        menuStash?.ref === ref.name && menuStash?.hash === commit.hash
                      }
                      isBranchMenuOpen={
                        menuBranch?.name === ref.name && menuBranch?.commitHash === commit.hash
                      }
                      isCurrent={ref.name === graphData?.head?.branch}
                      onToggleStashMenu={(refName, hash, rect) => {
                        if (!refName) {
                          setMenuStash(null)
                        } else {
                          const containerRect = containerRef.current?.getBoundingClientRect()
                          setMenuStash({
                            ref: refName,
                            hash,
                            x: rect.left - (containerRect?.left ?? 0),
                            y:
                              rect.bottom -
                              (containerRect?.top ?? 0) +
                              (containerRef.current?.scrollTop ?? 0),
                          })
                          setMenuCommit(null)
                          setMenuBranch(null)
                        }
                      }}
                      onToggleBranchMenu={(refInf, cHash, cShortHash, rect) => {
                        if (!cHash) {
                          setMenuBranch(null)
                        } else {
                          const containerRect = containerRef.current?.getBoundingClientRect()
                          setMenuBranch({
                            name: refInf.name,
                            local: refInf.local,
                            remote: refInf.remote,
                            commitHash: cHash,
                            commitShortHash: cShortHash,
                            x: rect.left - (containerRect?.left ?? 0),
                            y:
                              rect.bottom -
                              (containerRect?.top ?? 0) +
                              (containerRef.current?.scrollTop ?? 0),
                          })
                          setMenuCommit(null)
                        }
                      }}
                    />
                  )

                return (
                  <div
                    key={row}
                    className={`absolute left-0 right-0 ${isExpanded ? 'z-40' : ''}`}
                    style={{ top: rowToY(row), height: ROW_HEIGHT }}
                  >
                    <div className="flex flex-row items-center gap-1 px-2 h-full overflow-hidden">
                      {renderRefBadge(primaryRef)}
                      {extraCount > 0 && (
                        <span
                          className="inline-flex items-center px-1.5 py-1 text-xs rounded font-medium leading-none bg-bg-surface text-text-muted ring-1 ring-border-default cursor-default shrink-0"
                          onMouseEnter={() => {
                            if (expandedRowTimeout.current) {
                              clearTimeout(expandedRowTimeout.current)
                              expandedRowTimeout.current = null
                            }
                            setExpandedRow(row)
                          }}
                          onMouseLeave={() => {
                            expandedRowTimeout.current = setTimeout(() => setExpandedRow(null), 300)
                          }}
                        >
                          +{extraCount}
                        </span>
                      )}
                    </div>
                    {isExpanded && extraCount > 0 && (
                      <div
                        className="absolute left-2 z-50 flex flex-col gap-1 p-1.5 bg-bg-surface border border-border-default rounded-[var(--radius-xl)] shadow-xl min-w-[160px]"
                        style={{ top: ROW_HEIGHT }}
                        onMouseEnter={() => {
                          if (expandedRowTimeout.current) {
                            clearTimeout(expandedRowTimeout.current)
                            expandedRowTimeout.current = null
                          }
                          setExpandedRow(row)
                        }}
                        onMouseLeave={() => {
                          expandedRowTimeout.current = setTimeout(() => setExpandedRow(null), 300)
                        }}
                      >
                        {refs.slice(1).map((ref) => renderRefBadge(ref))}
                      </div>
                    )}
                  </div>
                )
              })}
              {/* Detached HEAD indicator */}
              {nodes.some((n) => n.isHead && n.commit.refs.length === 0) &&
                (() => {
                  const headIdx = nodes.findIndex((n) => n.isHead)
                  if (headIdx === -1) return null
                  return (
                    <div
                      className="absolute left-0 right-0 flex items-center px-2"
                      style={{ top: rowToY(headIdx), height: ROW_HEIGHT }}
                    >
                      <span className="px-1.5 py-0.5 text-xs rounded font-medium leading-none bg-warning/20 text-warning ring-1 ring-warning/40">
                        HEAD
                      </span>
                    </div>
                  )
                })()}
            </div>

            {/* Drag handle for branch panel resize */}
            <div
              onMouseDown={branchPanel.onMouseDown}
              onTouchStart={branchPanel.onTouchStart}
              className="absolute top-0 bottom-0 z-10 w-3 cursor-col-resize hover:bg-action/40 active:bg-action/60 transition-colors touch-none"
              style={{ left: branchPanel.width - 6 }}
            />

            {/* Graph area (clipped to graphPanelWidth) */}
            <div
              className="absolute top-0 bottom-0 overflow-hidden"
              style={{ left: branchPanel.width + 4, width: graphPanel.width }}
            >
              <svg
                width={svgWidth}
                height={totalRows * ROW_HEIGHT}
                style={{ pointerEvents: 'none' }}
              >
                {renderWipSvg()}
                {renderEdges()}
                {renderNodes()}
              </svg>
            </div>

            {/* Drag handle for graph panel resize */}
            <div
              onMouseDown={graphPanel.onMouseDown}
              onTouchStart={graphPanel.onTouchStart}
              className="absolute top-0 bottom-0 z-10 w-3 cursor-col-resize hover:bg-action/40 active:bg-action/60 transition-colors touch-none"
              style={{ left: branchPanel.width + graphPanel.width - 2 }}
            />

            {/* WIP row */}
            <WipRow
              workingChanges={graphData?.workingChanges}
              selectedCommit={selectedCommit}
              sessionName={sessionName}
              headRow={headRow}
              branchPanelWidth={branchPanel.width}
              graphPanelWidth={graphPanel.width}
              onSelectCommit={onSelectCommit}
              afterAction={afterAction}
              gitAction={gitAction}
            />

            {/* Day separators */}
            {daySeparators.map(({ row, label }) => (
              <div
                key={`day-${row}`}
                className="absolute flex items-center pointer-events-none"
                style={{
                  top: rowToY(row),
                  height: ROW_HEIGHT,
                  right: 8,
                }}
              >
                <span className="text-[11px] font-medium text-text-muted/70 whitespace-nowrap">
                  {label}
                </span>
              </div>
            ))}

            {/* HTML rows for commit info */}
            {nodes.map((node, row) => {
              const isSelected =
                selectedCommit === node.commit.hash || compareCommit === node.commit.hash
              const inComparedRange =
                comparedRows != null && row >= comparedRows.first && row <= comparedRows.last
              const dimmed = dimOpacity(node.commit.hash) < 1
              return (
                <div
                  key={node.commit.hash}
                  data-testid={dimmed ? 'graph-row-dimmed' : 'graph-row'}
                  // Shift-drag would otherwise select the row text instead of the range.
                  onMouseDown={(e) => {
                    if (e.shiftKey) e.preventDefault()
                  }}
                  onClick={(e) => onSelectCommit?.(node.commit.hash, e.shiftKey)}
                  title="Shift-click another commit to diff the two"
                  className={`absolute right-0 flex items-center gap-2 px-1 cursor-pointer group ${
                    dimmed ? 'opacity-25' : ''
                  } ${
                    isSelected
                      ? 'bg-action/25 border-l-2 border-l-action'
                      : inComparedRange
                        ? 'bg-action/15 border-l-2 border-l-action/40'
                        : node.isHead
                          ? 'bg-action/[0.14] hover:bg-action/20'
                          : node.onCurrentBranch
                            ? 'bg-action/[0.06] hover:bg-action/[0.12]'
                            : 'hover:bg-bg-surface/50 opacity-60'
                  }`}
                  style={{
                    top: rowToY(row),
                    height: ROW_HEIGHT,
                    left: branchPanel.width + graphPanel.width + 8,
                    paddingLeft: 4,
                  }}
                >
                  {/* Commit message */}
                  <span
                    className={`text-base truncate min-w-0 ${
                      node.commit.stash
                        ? 'text-slate-400 italic'
                        : node.onCurrentBranch
                          ? 'text-text-primary'
                          : 'text-text-tertiary'
                    }`}
                  >
                    {node.commit.message}
                  </span>
                  {/* Worktree fleet badge */}
                  {(() => {
                    const wt = worktreeByShortHash.get(node.commit.shortHash)
                    if (!wt || wt.isMain) return null
                    return (
                      <WorktreeBadge
                        worktree={wt}
                        session={wt.sessionName ? sessionsByName.get(wt.sessionName) : undefined}
                      />
                    )
                  })()}
                  {/* Context menu button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation()
                      setMenuBranch(null)
                      setMenuCommit(
                        menuCommit?.hash === node.commit.hash
                          ? null
                          : {
                              hash: node.commit.hash,
                              shortHash: node.commit.shortHash,
                              message: node.commit.message,
                              pushed: node.commit.pushed ?? true,
                              refs: node.commit.refs,
                            }
                      )
                    }}
                    className={`ml-auto shrink-0 p-0.5 rounded hover:bg-control-bg-hover text-text-muted hover:text-text-secondary transition-opacity ${
                      menuCommit?.hash === node.commit.hash
                        ? 'opacity-100 bg-control-bg-hover'
                        : 'opacity-0 group-hover:opacity-100'
                    }`}
                    title={`${node.commit.shortHash} · ${node.commit.author} · ${relativeDate(node.commit.relativeDate)}`}
                  >
                    <MoreVertical size={20} />
                  </button>
                </div>
              )
            })}

            {/* Context menu dropdown */}
            <CommitContextMenu
              menuCommit={menuCommit}
              nodes={nodes}
              rowToY={rowToY}
              graphData={graphData}
              menuRef={menuRef}
              handleReword={handleReword}
              handleCreateBranch={handleCreateBranch}
              handleCherryPick={handleCherryPick}
              handleCheckout={handleCheckout}
              handleResetSoft={handleResetSoft}
              handleResetHard={handleResetHard}
            />

            {/* Stash context menu */}
            <StashContextMenu
              menuStash={menuStash}
              stashMenuRef={stashMenuRef}
              handleStashPop={handleStashPop}
              handleStashDrop={handleStashDrop}
            />

            <TagContextMenu
              menuTag={menuTag}
              tagMenuRef={tagMenuRef}
              remoteTags={remoteTags}
              onDelete={handleDeleteTag}
            />

            {/* Branch context menu */}
            <BranchContextMenu
              menuBranch={menuBranch}
              branchMenuRef={branchMenuRef}
              graphData={graphData}
              handleBranchCheckout={handleBranchCheckout}
              handleBranchPush={handleBranchPush}
              handleResetTo={handleResetTo}
              setDeleteBranchConfirm={setDeleteBranchConfirm}
              setMenuBranch={setMenuBranch}
            />
          </div>
        )}

        {/* Delete branch confirmation modal */}
        <DeleteBranchModal
          sessionName={sessionName}
          branch={deleteBranchConfirm}
          onDone={() => {
            setDeleteBranchConfirm(null)
            afterAction()
          }}
          onCancel={() => setDeleteBranchConfirm(null)}
        />
      </div>
    </div>
  )
}
