export interface DiffFile {
  path: string
  diff: string
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
