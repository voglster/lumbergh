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
