import { useState, useEffect, useCallback, useMemo, useRef } from 'react'
import type { GraphData } from '../diff/types'
import { computeGraphLayout, laneColor } from './graphLayout'

const ROW_HEIGHT = 36
const LANE_WIDTH = 16
const NODE_RADIUS = 4
const HEAD_RADIUS = 6
const SVG_PADDING_LEFT = 8
const WIP_COLOR = '#ffb74d' // orange for WIP

interface Props {
  apiHost: string
  sessionName?: string
  onSelectCommit?: (hash: string | null) => void
  selectedCommit?: string | null
  refreshTrigger?: number
  onGitAction?: () => void
}

export default function GitGraph({ apiHost, sessionName, onSelectCommit, selectedCommit, refreshTrigger, onGitAction }: Props) {
  const [graphData, setGraphData] = useState<GraphData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [commitLimit, setCommitLimit] = useState(100)
  const [menuCommit, setMenuCommit] = useState<{ hash: string; shortHash: string; message: string; pushed: boolean } | null>(null)
  const containerRef = useRef<HTMLDivElement>(null)
  const menuRef = useRef<HTMLDivElement>(null)

  // Fetch configured commit limit from settings
  useEffect(() => {
    fetch(`http://${apiHost}/api/settings`)
      .then((r) => r.json())
      .then((s) => {
        if (s.gitGraphCommits) setCommitLimit(s.gitGraphCommits)
      })
      .catch(() => {})
  }, [apiHost])

  const fetchGraph = useCallback(async () => {
    if (!sessionName) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`http://${apiHost}/api/sessions/${sessionName}/git/graph?limit=${commitLimit}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data: GraphData = await res.json()
      setGraphData(data)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch graph')
    } finally {
      setLoading(false)
    }
  }, [apiHost, sessionName, commitLimit])

  // Fetch on mount + poll every 5s (matches diff polling cadence)
  // Also re-fetch when refreshTrigger bumps (after git actions)
  useEffect(() => {
    fetchGraph()
    const interval = setInterval(fetchGraph, 5000)
    return () => clearInterval(interval)
  }, [fetchGraph, refreshTrigger])

  // Close menu on click-outside or Escape
  useEffect(() => {
    if (!menuCommit) return

    const handleClickOutside = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuCommit(null)
      }
    }
    const handleEscape = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuCommit(null)
    }

    document.addEventListener('mousedown', handleClickOutside)
    document.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
      document.removeEventListener('keydown', handleEscape)
    }
  }, [menuCommit])

  const afterAction = useCallback(() => {
    setMenuCommit(null)
    fetchGraph()
    onGitAction?.()
  }, [fetchGraph, onGitAction])

  const handleCreateBranch = useCallback(async () => {
    if (!menuCommit || !sessionName) return
    const name = prompt('Branch name:')
    if (!name) return

    try {
      const res = await fetch(`http://${apiHost}/api/sessions/${sessionName}/git/create-branch`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, start_point: menuCommit.hash }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || `Failed to create branch (HTTP ${res.status})`)
        return
      }
      afterAction()
    } catch {
      alert('Failed to create branch')
    }
  }, [apiHost, sessionName, menuCommit, afterAction])

  const handleResetSoft = useCallback(async () => {
    if (!menuCommit || !sessionName) return

    try {
      const res = await fetch(`http://${apiHost}/api/sessions/${sessionName}/git/reset-to`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: menuCommit.hash, mode: 'soft' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || `Reset failed (HTTP ${res.status})`)
        return
      }
      afterAction()
    } catch {
      alert('Reset failed')
    }
  }, [apiHost, sessionName, menuCommit, afterAction])

  const handleResetHard = useCallback(async () => {
    if (!menuCommit || !sessionName) return

    const confirmed = confirm(
      `Reset HARD to ${menuCommit.shortHash}?\n\nThis will DESTROY all uncommitted changes (staged, unstaged, and untracked files). This cannot be undone.`
    )
    if (!confirmed) return

    try {
      const res = await fetch(`http://${apiHost}/api/sessions/${sessionName}/git/reset-to`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: menuCommit.hash, mode: 'hard' }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || `Reset failed (HTTP ${res.status})`)
        return
      }
      afterAction()
    } catch {
      alert('Reset failed')
    }
  }, [apiHost, sessionName, menuCommit, afterAction])

  const handleReword = useCallback(async () => {
    if (!menuCommit || !sessionName) return
    const newMessage = prompt('Edit commit message:', menuCommit.message)
    if (newMessage === null || newMessage === menuCommit.message) return

    try {
      const res = await fetch(`http://${apiHost}/api/sessions/${sessionName}/git/reword`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hash: menuCommit.hash, message: newMessage }),
      })
      if (!res.ok) {
        const data = await res.json().catch(() => ({}))
        alert(data.detail || `Reword failed (HTTP ${res.status})`)
        return
      }
      afterAction()
    } catch {
      alert('Failed to reword commit')
    }
  }, [apiHost, sessionName, menuCommit, afterAction])

  const nodes = useMemo(() => {
    if (!graphData) return []
    return computeGraphLayout(graphData.commits, graphData.head?.hash ?? null)
  }, [graphData])

  const hasWip = graphData?.workingChanges != null
  // Find which row HEAD is on so we can insert WIP right above it
  const headRow = useMemo(() => {
    const idx = nodes.findIndex((n) => n.isHead)
    return idx >= 0 ? idx : 0
  }, [nodes])
  // Helper: map a commit row index to its pixel position, accounting for WIP insertion
  const rowToY = useCallback((row: number) => {
    if (!hasWip) return row * ROW_HEIGHT
    // Rows before HEAD are unshifted; HEAD and after shift down by 1 to make room for WIP
    return row < headRow ? row * ROW_HEIGHT : (row + 1) * ROW_HEIGHT
  }, [hasWip, headRow])

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
        <circle
          cx={cx}
          cy={wipY}
          r={3}
          fill={WIP_COLOR}
        />
      </g>
    )
  }

  const renderEdges = () => {
    const lines: JSX.Element[] = []
    for (const node of nodes) {
      for (let ei = 0; ei < node.edges.length; ei++) {
        const e = node.edges[ei]
        const x1 = SVG_PADDING_LEFT + e.fromLane * LANE_WIDTH + LANE_WIDTH / 2
        const y1 = rowToY(e.fromRow) + ROW_HEIGHT / 2
        const x2 = SVG_PADDING_LEFT + e.toLane * LANE_WIDTH + LANE_WIDTH / 2
        const y2 = rowToY(e.toRow) + ROW_HEIGHT / 2
        const color = laneColor(e.fromLane)
        const key = `${node.commit.shortHash}-${ei}`
        const isCurrentBranchEdge = node.onCurrentBranch && e.fromLane === headLane && e.toLane === headLane
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
          const midY = (y1 + y2) / 2
          lines.push(
            <path
              key={key}
              d={`M ${x1} ${y1} C ${x1} ${midY}, ${x2} ${midY}, ${x2} ${y2}`}
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

      if (node.isHead) {
        return (
          <g key={node.commit.hash}>
            {/* Pulsing glow */}
            <circle cx={cx} cy={cy} r={12} fill={color} opacity={0.15}>
              <animate attributeName="r" values="10;14;10" dur="2s" repeatCount="indefinite" />
              <animate attributeName="opacity" values="0.18;0.08;0.18" dur="2s" repeatCount="indefinite" />
            </circle>
            {/* Outer ring */}
            <circle cx={cx} cy={cy} r={HEAD_RADIUS + 3} fill="none" stroke={color} strokeWidth={2} opacity={0.6} />
            {/* White inner ring for contrast */}
            <circle cx={cx} cy={cy} r={HEAD_RADIUS + 1} fill="none" stroke="white" strokeWidth={1} opacity={0.3} />
            {/* Solid dot */}
            <circle cx={cx} cy={cy} r={HEAD_RADIUS} fill={color} />
          </g>
        )
      }
      return (
        <circle
          key={node.commit.hash}
          cx={cx}
          cy={cy}
          r={node.onCurrentBranch ? NODE_RADIUS + 1 : NODE_RADIUS}
          fill={color}
          opacity={node.onCurrentBranch ? 1 : 0.4}
        />
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
      {error && (
        <div className="px-3 py-2 text-sm text-red-400 bg-red-500/10">
          {error}
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
            {/* SVG layer for lines and dots */}
            <svg
              className="absolute top-0 left-0"
              width={svgWidth}
              height={totalRows * ROW_HEIGHT}
              style={{ pointerEvents: 'none' }}
            >
              {renderWipSvg()}
              {renderEdges()}
              {renderNodes()}
            </svg>

            {/* WIP row */}
            {hasWip && graphData?.workingChanges && (
              <div
                onClick={() => onSelectCommit?.(null)}
                className={`absolute left-0 right-0 flex items-center gap-2 px-1 border-b border-orange-500/20 cursor-pointer ${
                  selectedCommit === null
                    ? 'bg-orange-500/[0.2] border-l-2 border-l-orange-400'
                    : 'bg-orange-500/[0.1] hover:bg-orange-500/[0.16]'
                }`}
                style={{
                  top: headRow * ROW_HEIGHT,
                  height: ROW_HEIGHT,
                  paddingLeft: svgWidth + 4,
                }}
              >
                <span className="px-1.5 py-0.5 text-[10px] rounded font-semibold leading-none bg-orange-500/25 text-orange-300 ring-1 ring-orange-400/50 shrink-0">
                  WIP
                </span>
                <span className="text-sm text-orange-200/90 truncate min-w-0">
                  {graphData.workingChanges.files} uncommitted {graphData.workingChanges.files === 1 ? 'change' : 'changes'}
                </span>
              </div>
            )}

            {/* HTML rows for commit info */}
            {nodes.map((node, row) => {
              const isSelected = selectedCommit === node.commit.hash
              return (
              <div
                key={node.commit.hash}
                onClick={() => onSelectCommit?.(node.commit.hash)}
                className={`absolute left-0 right-0 flex items-center gap-2 px-1 cursor-pointer group ${
                  isSelected
                    ? 'bg-blue-500/[0.25] border-l-2 border-l-blue-400'
                    : node.isHead
                      ? 'bg-blue-500/[0.14] hover:bg-blue-500/[0.2]'
                      : node.onCurrentBranch
                        ? 'bg-blue-500/[0.06] hover:bg-blue-500/[0.12]'
                        : 'hover:bg-bg-surface/50 opacity-60'
                }`}
                style={{
                  top: rowToY(row),
                  height: ROW_HEIGHT,
                  paddingLeft: svgWidth + 4,
                }}
              >
                {/* Ref badges */}
                {node.commit.refs.length > 0 && (
                  <div className="flex gap-1 shrink-0">
                    {node.commit.refs.map((ref) => {
                      const isCurrent = graphData?.head?.branch === ref
                      return (
                        <span
                          key={ref}
                          className={`px-1.5 py-0.5 text-[10px] rounded font-medium leading-none ${
                            isCurrent
                              ? 'bg-blue-500/25 text-blue-300 ring-1 ring-blue-400/50'
                              : 'bg-bg-surface text-text-tertiary ring-1 ring-border-default'
                          }`}
                        >
                          {ref}
                        </span>
                      )
                    })}
                  </div>
                )}
                {node.isHead && node.commit.refs.length === 0 && (
                  <span className="px-1.5 py-0.5 text-[10px] rounded font-medium leading-none bg-yellow-500/20 text-yellow-300 ring-1 ring-yellow-500/40 shrink-0">
                    HEAD
                  </span>
                )}
                {/* Commit message */}
                <span className={`text-sm truncate min-w-0 ${
                  node.onCurrentBranch ? 'text-text-primary' : 'text-text-tertiary'
                }`}>
                  {node.commit.message}
                </span>
                {/* Author + date */}
                <span className="ml-auto text-xs text-text-muted whitespace-nowrap shrink-0 hidden sm:inline">
                  {node.commit.shortHash}
                </span>
                <span className="text-xs text-text-muted whitespace-nowrap shrink-0 hidden lg:inline">
                  {node.commit.author}
                </span>
                <span className="text-xs text-text-muted whitespace-nowrap shrink-0">
                  {node.commit.relativeDate}
                </span>
                {/* Context menu button */}
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    setMenuCommit(
                      menuCommit?.hash === node.commit.hash
                        ? null
                        : { hash: node.commit.hash, shortHash: node.commit.shortHash, message: node.commit.message, pushed: node.commit.pushed ?? true }
                    )
                  }}
                  className={`shrink-0 p-0.5 rounded hover:bg-control-bg-hover text-text-muted hover:text-text-secondary transition-opacity ${
                    menuCommit?.hash === node.commit.hash ? 'opacity-100 bg-control-bg-hover' : 'opacity-0 group-hover:opacity-100'
                  }`}
                  title="Actions"
                >
                  <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                    <path d="M10 6a2 2 0 110-4 2 2 0 010 4zM10 12a2 2 0 110-4 2 2 0 010 4zM10 18a2 2 0 110-4 2 2 0 010 4z" />
                  </svg>
                </button>
              </div>
              )
            })}

            {/* Context menu dropdown */}
            {menuCommit && (() => {
              const menuRow = nodes.findIndex((n) => n.commit.hash === menuCommit.hash)
              if (menuRow === -1) return null
              const topPx = rowToY(menuRow) + ROW_HEIGHT
              return (
                <div
                  ref={menuRef}
                  className="absolute right-2 z-50 w-52 py-1 bg-bg-surface border border-border-default rounded-lg shadow-xl"
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
                  <div className="mx-2 my-1 border-t border-border-default" />
                  <button
                    onClick={handleResetSoft}
                    className="w-full text-left px-3 py-1.5 text-sm text-text-secondary hover:bg-control-bg-hover hover:text-text-primary"
                  >
                    Reset soft to here
                  </button>
                  <button
                    onClick={handleResetHard}
                    className="w-full text-left px-3 py-1.5 text-sm text-red-400 hover:bg-red-500/10 hover:text-red-300"
                  >
                    Reset hard to here
                  </button>
                </div>
              )
            })()}
          </div>
        )}
      </div>
    </div>
  )
}
