import type { FileStats } from './types'

// Extract the diff content starting from --- line
// The library expects: --- a/file\n+++ b/file\n@@ ... @@\n...
export function extractDiffContent(diff: string): string[] {
  const lines = diff.split('\n')
  const result: string[] = []
  let started = false

  for (const line of lines) {
    if (line.startsWith('--- ')) {
      started = true
    }
    if (started) {
      result.push(line)
    }
  }

  return result.length > 0 ? [result.join('\n')] : []
}

// Calculate per-file stats from diff content
export function getFileStats(diff: string): FileStats {
  const lines = diff.split('\n')
  let additions = 0
  let deletions = 0

  for (const line of lines) {
    if (line.startsWith('+') && !line.startsWith('+++')) {
      additions++
    } else if (line.startsWith('-') && !line.startsWith('---')) {
      deletions++
    }
  }

  return { additions, deletions }
}

// Extract language from file path for syntax highlighting
export function getLangFromPath(path: string): string {
  const ext = path.split('.').pop()?.toLowerCase() || ''
  const extMap: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    py: 'python',
    rs: 'rust',
    go: 'go',
    java: 'java',
    css: 'css',
    scss: 'scss',
    json: 'json',
    md: 'markdown',
    sh: 'bash',
    yml: 'yaml',
    yaml: 'yaml',
  }
  return extMap[ext] || 'plaintext'
}

