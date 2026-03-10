import type { GraphCommit, GraphNode, GraphEdge } from '../diff/types'

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

export function computeGraphLayout(commits: GraphCommit[], headHash: string | null): GraphNode[] {
  // Pre-compute the current branch hashes (first-parent chain from HEAD)
  // so we can reserve lane 0 for them
  const currentBranchSet = new Set<string>()
  if (headHash) {
    const hashToCommit = new Map(commits.map((c) => [c.hash, c]))
    let h: string | null = headHash
    while (h) {
      currentBranchSet.add(h)
      const c = hashToCommit.get(h)
      if (!c) break
      h = c.parents[0] ?? null
    }
  }

  // activeLanes[i] = hash that lane i is expecting (the parent we're waiting for)
  const activeLanes: (string | null)[] = []
  // Map from hash to row index for connecting edges
  const hashToRow = new Map<string, number>()

  const nodes: GraphNode[] = []

  for (let row = 0; row < commits.length; row++) {
    const commit = commits[row]
    hashToRow.set(commit.hash, row)

    // Find which lane this commit occupies (if any lane is expecting it)
    let lane = activeLanes.indexOf(commit.hash)

    if (lane === -1) {
      // Not expected by any lane — allocate a new one
      // Reserve lane 0 for the current branch
      if (currentBranchSet.has(commit.hash)) {
        if (activeLanes.length === 0) {
          activeLanes.push(null)
          lane = 0
        } else if (activeLanes[0] === null) {
          lane = 0
        } else {
          // Lane 0 is occupied by another branch — evict it
          const displaced = activeLanes[0]
          // Find a free lane for the displaced hash
          let newLane = -1
          for (let i = 1; i < activeLanes.length; i++) {
            if (activeLanes[i] === null) {
              newLane = i
              break
            }
          }
          if (newLane === -1) {
            newLane = activeLanes.length
            activeLanes.push(null)
          }
          activeLanes[newLane] = displaced
          // Move all previously placed non-current-branch nodes from lane 0
          for (let prev = 0; prev < row; prev++) {
            if (nodes[prev].lane === 0 && !currentBranchSet.has(nodes[prev].commit.hash)) {
              nodes[prev].lane = newLane
            }
          }
          lane = 0
        }
      } else {
        const start = activeLanes.length > 0 && currentBranchSet.size > 0 ? 1 : 0
        lane = -1
        for (let i = start; i < activeLanes.length; i++) {
          if (activeLanes[i] === null) {
            lane = i
            break
          }
        }
        if (lane === -1) {
          lane = activeLanes.length
          activeLanes.push(null)
        }
      }
    }

    // This lane is now fulfilled
    activeLanes[lane] = null

    const edges: GraphEdge[] = []

    // Process parents
    for (let p = 0; p < commit.parents.length; p++) {
      const parentHash = commit.parents[p]

      if (p === 0) {
        // First parent continues in the same lane
        activeLanes[lane] = parentHash
        // Edge will be drawn when the parent row is processed, but we record it now
        // as a downward edge from this row in lane
      } else {
        // Other parents: find an existing lane expecting this parent, or allocate new
        let parentLane = activeLanes.indexOf(parentHash)
        if (parentLane === -1) {
          // Allocate a new lane
          parentLane = activeLanes.indexOf(null)
          if (parentLane === -1) {
            parentLane = activeLanes.length
            activeLanes.push(null)
          }
          activeLanes[parentLane] = parentHash
        }
      }
    }

    // Close empty lanes at the end to keep the graph compact
    while (activeLanes.length > 0 && activeLanes[activeLanes.length - 1] === null) {
      activeLanes.pop()
    }

    nodes.push({
      commit,
      lane,
      edges, // edges populated in second pass
      isHead: commit.hash === headHash,
      onCurrentBranch: false, // set in third pass
    })
  }

  // Second pass: compute edges by looking at parent relationships
  for (let row = 0; row < nodes.length; row++) {
    const node = nodes[row]
    for (const parentHash of node.commit.parents) {
      const parentRow = hashToRow.get(parentHash)
      if (parentRow !== undefined) {
        const parentNode = nodes[parentRow]
        node.edges.push({
          fromLane: node.lane,
          toLane: parentNode.lane,
          fromRow: row,
          toRow: parentRow,
        })
      }
    }
  }

  // Third pass: mark commits on the current branch
  for (const node of nodes) {
    node.onCurrentBranch = currentBranchSet.has(node.commit.hash)
  }

  return nodes
}
