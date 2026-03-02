export interface DiffFile {
  path: string
  diff: string
  oldContent?: string | null
  newContent?: string | null
}

export interface Commit {
  hash: string
  shortHash: string
  message: string
  author: string
  relativeDate: string
}

export interface CommitDiff extends Commit {
  files: DiffFile[]
  stats: {
    additions: number
    deletions: number
  }
}

export interface DiffData {
  files: DiffFile[]
  stats: {
    additions: number
    deletions: number
  }
}

export interface FileStats {
  additions: number
  deletions: number
}

export interface Branch {
  name: string
  current?: boolean
  remote?: string
}

export interface BranchData {
  current: string
  local: Branch[]
  remote: Branch[]
  clean: boolean
}

// Git graph types

export interface GraphCommit {
  hash: string
  shortHash: string
  message: string
  author: string
  relativeDate: string
  parents: string[]
  refs: string[]
  pushed?: boolean
}

export interface GraphData {
  commits: GraphCommit[]
  branches: { name: string; hash: string; current: boolean }[]
  head: { hash: string; branch: string | null } | null
  workingChanges: { files: number; staged: number; unstaged: number } | null
}

export interface GraphEdge {
  fromLane: number
  toLane: number
  fromRow: number
  toRow: number
}

export interface GraphNode {
  commit: GraphCommit
  lane: number
  edges: GraphEdge[]
  isHead: boolean
  onCurrentBranch: boolean
}
