export interface DiffFile {
  path: string
  diff: string
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
