import type { GraphCommit, GraphNode } from '../diff/types'

const LANE_COLORS = [
  '#4fc3f7', // blue
  '#81c784', // green
  '#ffb74d', // orange
  '#e57373', // red
  '#ba68c8', // purple
  '#4dd0e1', // cyan
  '#fff176', // yellow
  '#f06292', // pink
  '#aed581', // light green
  '#90a4ae', // grey
]

export function laneColor(lane: number): string {
  return LANE_COLORS[lane % LANE_COLORS.length]
}

/** Find the first free lane starting from `start`, or allocate a new one */
function findFreeLane(activeLanes: (string | null)[], start: number): number {
  for (let i = start; i < activeLanes.length; i++) {
    if (activeLanes[i] === null) return i
  }
  activeLanes.push(null)
  return activeLanes.length - 1
}

/** Build a set of commit hashes on the current branch (first-parent chain from HEAD) */
function buildCurrentBranchSet(commits: GraphCommit[], headHash: string | null): Set<string> {
  const set = new Set<string>()
  if (!headHash) return set
  const hashToCommit = new Map(commits.map((c) => [c.hash, c]))
  let h: string | null = headHash
  while (h) {
    set.add(h)
    const c = hashToCommit.get(h)
    if (!c) break
    h = c.parents[0] ?? null
  }
  return set
}

/** Allocate lane 0 for a current-branch commit, evicting if necessary */
function allocateCurrentBranchLane(
  activeLanes: (string | null)[],
  nodes: GraphNode[],
  row: number,
  currentBranchSet: Set<string>
): number {
  if (activeLanes.length === 0) {
    activeLanes.push(null)
    return 0
  }
  if (activeLanes[0] === null) {
    return 0
  }
  // Lane 0 is occupied — evict it
  const displaced = activeLanes[0]
  const newLane = findFreeLane(activeLanes, 1)
  activeLanes[newLane] = displaced
  // Move all previously placed non-current-branch nodes from lane 0
  for (let prev = 0; prev < row; prev++) {
    if (nodes[prev].lane === 0 && !currentBranchSet.has(nodes[prev].commit.hash)) {
      nodes[prev].lane = newLane
    }
  }
  return 0
}

/** Assign a lane for a commit not yet expected by any active lane */
function allocateNewLane(
  activeLanes: (string | null)[],
  isOnCurrentBranch: boolean,
  currentBranchSet: Set<string>,
  nodes: GraphNode[],
  row: number
): number {
  if (isOnCurrentBranch) {
    return allocateCurrentBranchLane(activeLanes, nodes, row, currentBranchSet)
  }
  const start = activeLanes.length > 0 && currentBranchSet.size > 0 ? 1 : 0
  return findFreeLane(activeLanes, start)
}

/** Process parent commits: assign first parent to same lane, allocate lanes for merge parents */
function processParents(commit: GraphCommit, lane: number, activeLanes: (string | null)[]): void {
  for (let p = 0; p < commit.parents.length; p++) {
    const parentHash = commit.parents[p]
    if (p === 0) {
      activeLanes[lane] = parentHash
    } else {
      let parentLane = activeLanes.indexOf(parentHash)
      if (parentLane === -1) {
        parentLane = findFreeLane(activeLanes, 0)
        activeLanes[parentLane] = parentHash
      }
    }
  }
}

export function computeGraphLayout(commits: GraphCommit[], headHash: string | null): GraphNode[] {
  const currentBranchSet = buildCurrentBranchSet(commits, headHash)
  const activeLanes: (string | null)[] = []
  const hashToRow = new Map<string, number>()
  const nodes: GraphNode[] = []

  // First pass: assign lanes
  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row]
    hashToRow.set(commit.hash, row)

    let lane = activeLanes.indexOf(commit.hash)
    if (lane === -1) {
      lane = allocateNewLane(
        activeLanes,
        currentBranchSet.has(commit.hash),
        currentBranchSet,
        nodes,
        row
      )
    }

    activeLanes[lane] = null
    processParents(commit, lane, activeLanes)

    // Trim trailing empty lanes
    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop()
    }

    nodes.push({
      commit,
      lane,
      edges: [],
      isHead: commit.hash === headHash,
      onCurrentBranch: currentBranchSet.has(commit.hash),
    })
  }

  // Second pass: compute edges
  for (let row = 0; row < nodes.length; row++) {
    const node = nodes[row]
    for (const parentHash of node.commit.parents) {
      const parentRow = hashToRow.get(parentHash)
      if (parentRow !== undefined) {
        node.edges.push({
          fromLane: node.lane,
          toLane: nodes[parentRow].lane,
          fromRow: row,
          toRow: parentRow,
        })
      }
    }
  }

  return nodes
}
