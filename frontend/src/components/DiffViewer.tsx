import { useState, useEffect, useCallback } from 'react'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import '@git-diff-view/react/styles/diff-view.css'

interface DiffFile {
  path: string
  diff: string
}

interface DiffData {
  files: DiffFile[]
  stats: {
    additions: number
    deletions: number
  }
}

interface Props {
  apiHost: string
}

// Extract the diff content starting from --- line
// The library expects: --- a/file\n+++ b/file\n@@ ... @@\n...
function extractDiffContent(diff: string): string[] {
  const lines = diff.split('\n')
  const result: string[] = []
  let started = false

  for (const line of lines) {
    // Start capturing from the --- line
    if (line.startsWith('--- ')) {
      started = true
    }
    if (started) {
      result.push(line)
    }
  }

  // Return as a single diff string if we have content
  return result.length > 0 ? [result.join('\n')] : []
}

// Extract language from file path
function getLangFromPath(path: string): string {
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

export default function DiffViewer({ apiHost }: Props) {
  const [data, setData] = useState<DiffData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<string | null>(null)

  const fetchDiff = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`http://${apiHost}/api/git/diff`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setData(json)
      // Auto-select first file
      if (json.files?.length > 0 && !selectedFile) {
        setSelectedFile(json.files[0].path)
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch diff')
    } finally {
      setLoading(false)
    }
  }, [apiHost, selectedFile])

  useEffect(() => {
    fetchDiff()
  }, [fetchDiff])

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Loading diff...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <span className="text-red-400">Error: {error}</span>
        <button
          onClick={fetchDiff}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white"
        >
          Retry
        </button>
      </div>
    )
  }

  if (!data || data.files.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4 text-gray-500">
        <span>No changes detected</span>
        <button
          onClick={fetchDiff}
          className="px-4 py-2 bg-gray-700 hover:bg-gray-600 rounded text-white"
        >
          Refresh
        </button>
      </div>
    )
  }

  const currentFile = data.files.find(f => f.path === selectedFile) || data.files[0]
  const hunks = extractDiffContent(currentFile.diff)
  const lang = getLangFromPath(currentFile.path)

  return (
    <div className="h-full flex flex-col">
      {/* Header with file selector and stats */}
      <div className="flex items-center gap-3 p-2 bg-gray-800 border-b border-gray-700">
        <select
          value={selectedFile || ''}
          onChange={(e) => setSelectedFile(e.target.value)}
          className="flex-1 bg-gray-700 text-white px-2 py-1.5 rounded border border-gray-600 text-sm font-mono truncate"
        >
          {data.files.map(file => (
            <option key={file.path} value={file.path}>
              {file.path}
            </option>
          ))}
        </select>
        <div className="flex items-center gap-2 text-sm whitespace-nowrap">
          <span className="text-green-400">+{data.stats.additions}</span>
          <span className="text-red-400">-{data.stats.deletions}</span>
        </div>
        <button
          onClick={fetchDiff}
          className="px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          ↻
        </button>
      </div>

      {/* Diff viewer */}
      <div className="flex-1 overflow-auto">
        {hunks.length > 0 ? (
          <DiffView
            data={{
              oldFile: { fileName: currentFile.path, fileLang: lang },
              newFile: { fileName: currentFile.path, fileLang: lang },
              hunks: hunks,
            }}
            diffViewMode={DiffModeEnum.Unified}
            diffViewTheme="dark"
            diffViewHighlight
            diffViewWrap
          />
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            No diff content for this file
          </div>
        )}
      </div>
    </div>
  )
}
