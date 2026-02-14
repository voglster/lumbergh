import { useState, useEffect, useCallback } from 'react'

interface FileEntry {
  path: string
  type: 'file' | 'directory'
  size: number | null
}

interface FileContent {
  content: string
  language: string
  path: string
}

interface Props {
  apiHost: string
}

export default function FileBrowser({ apiHost }: Props) {
  const [files, setFiles] = useState<FileEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())

  const fetchFiles = useCallback(async (silent = false) => {
    if (!silent) {
      setLoading(true)
      setError(null)
    }
    try {
      const res = await fetch(`http://${apiHost}/api/files`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setFiles(json.files)
    } catch (e) {
      if (!silent) {
        setError(e instanceof Error ? e.message : 'Failed to fetch files')
      }
    } finally {
      if (!silent) {
        setLoading(false)
      }
    }
  }, [apiHost])

  useEffect(() => {
    fetchFiles()

    // Auto-refresh every 5 seconds
    const interval = setInterval(() => {
      fetchFiles(true)
    }, 5000)

    return () => clearInterval(interval)
  }, [fetchFiles])

  const fetchFileContent = async (path: string) => {
    setLoadingFile(true)
    try {
      const res = await fetch(`http://${apiHost}/api/files/${encodeURIComponent(path)}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json()
      setSelectedFile(json)
    } catch (e) {
      setSelectedFile({
        content: `Error loading file: ${e instanceof Error ? e.message : 'Unknown error'}`,
        language: 'text',
        path,
      })
    } finally {
      setLoadingFile(false)
    }
  }

  const toggleDir = (path: string) => {
    setExpandedDirs(prev => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
  }

  // Build tree structure from flat file list
  const buildTree = (files: FileEntry[]) => {
    const tree: Map<string, FileEntry[]> = new Map()
    tree.set('', []) // root

    for (const file of files) {
      const parts = file.path.split('/')
      const parentPath = parts.slice(0, -1).join('/')

      if (!tree.has(parentPath)) {
        tree.set(parentPath, [])
      }
      tree.get(parentPath)!.push(file)
    }

    return tree
  }

  const renderTree = (tree: Map<string, FileEntry[]>, parentPath: string, depth: number) => {
    const children = tree.get(parentPath) || []

    // Sort: directories first, then files, both alphabetically
    const sorted = [...children].sort((a, b) => {
      if (a.type !== b.type) {
        return a.type === 'directory' ? -1 : 1
      }
      return a.path.localeCompare(b.path)
    })

    return sorted.map(entry => {
      const name = entry.path.split('/').pop() || entry.path
      const isExpanded = expandedDirs.has(entry.path)

      if (entry.type === 'directory') {
        return (
          <div key={entry.path}>
            <button
              onClick={() => toggleDir(entry.path)}
              className="w-full flex items-center gap-2 px-2 py-1 hover:bg-gray-800 text-left"
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              <span className="text-gray-500 text-xs">
                {isExpanded ? '▼' : '▶'}
              </span>
              <span className="text-yellow-400">📁</span>
              <span className="text-gray-300 truncate">{name}</span>
            </button>
            {isExpanded && renderTree(tree, entry.path, depth + 1)}
          </div>
        )
      }

      return (
        <button
          key={entry.path}
          onClick={() => fetchFileContent(entry.path)}
          className={`w-full flex items-center gap-2 px-2 py-1 hover:bg-gray-800 text-left ${
            selectedFile?.path === entry.path ? 'bg-gray-700' : ''
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <span className="text-gray-500 text-xs opacity-0">▶</span>
          <span className="text-gray-500">📄</span>
          <span className="text-gray-300 truncate">{name}</span>
          {entry.size !== null && (
            <span className="text-gray-600 text-xs ml-auto">
              {formatSize(entry.size)}
            </span>
          )}
        </button>
      )
    })
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`
  }

  const getLanguageClass = (lang: string): string => {
    // Basic syntax highlighting class mapping
    return `language-${lang}`
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Loading files...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <span className="text-red-400">Error: {error}</span>
        <button
          onClick={() => fetchFiles()}
          className="px-4 py-2 bg-blue-600 hover:bg-blue-500 rounded text-white"
        >
          Retry
        </button>
      </div>
    )
  }

  const tree = buildTree(files)

  return (
    <div className="h-full flex">
      {/* File tree sidebar */}
      <div className="w-64 flex-shrink-0 border-r border-gray-700 overflow-auto">
        <div className="p-2 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
          <span className="text-sm text-gray-400">Files</span>
          <button
            onClick={() => fetchFiles()}
            className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
          >
            Refresh
          </button>
        </div>
        <div className="py-1">
          {renderTree(tree, '', 0)}
        </div>
      </div>

      {/* File content viewer */}
      <div className="flex-1 overflow-auto">
        {loadingFile ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading file...
          </div>
        ) : selectedFile ? (
          <div className="h-full flex flex-col">
            <div className="p-2 bg-gray-800 border-b border-gray-700">
              <span className="font-mono text-sm text-blue-400">
                {selectedFile.path}
              </span>
              <span className="text-gray-500 text-xs ml-2">
                ({selectedFile.language})
              </span>
            </div>
            <pre className={`flex-1 p-4 overflow-auto text-sm font-mono text-gray-300 ${getLanguageClass(selectedFile.language)}`}>
              {selectedFile.content}
            </pre>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full text-gray-500">
            Select a file to view
          </div>
        )}
      </div>
    </div>
  )
}
