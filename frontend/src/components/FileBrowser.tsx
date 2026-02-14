import React, { useState, useEffect, useCallback, useRef } from 'react'
import hljs from 'highlight.js'
import 'highlight.js/styles/github-dark.css'
import MarkdownPreview from '@uiw/react-markdown-preview'
import mermaid from 'mermaid'

// Initialize mermaid with dark theme
mermaid.initialize({
  startOnLoad: false,
  theme: 'dark',
  securityLevel: 'loose',
})

// Extract text content from React children (can be string, array, or nested)
function getTextContent(children: React.ReactNode): string {
  if (typeof children === 'string') return children
  if (typeof children === 'number') return String(children)
  if (!children) return ''
  if (Array.isArray(children)) {
    return children.map(getTextContent).join('')
  }
  if (React.isValidElement(children)) {
    const props = children.props as { children?: React.ReactNode }
    if (props.children) {
      return getTextContent(props.children)
    }
  }
  return ''
}

// Mermaid diagram component
function MermaidDiagram({ code }: { code: string }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (ref.current && code) {
      const id = `mermaid-${Math.random().toString(36).substr(2, 9)}`
      mermaid.render(id, code).then(({ svg }) => {
        if (ref.current) {
          ref.current.innerHTML = svg
        }
      }).catch((err) => {
        if (ref.current) {
          ref.current.innerHTML = `<pre class="text-red-400 p-4">Mermaid error: ${err.message}</pre>`
        }
      })
    }
  }, [code])

  return <div ref={ref} className="flex justify-center my-4 overflow-auto" />
}

// Custom code component that renders mermaid diagrams
function Code({ children, className }: { children?: React.ReactNode; className?: string }) {
  // Check for mermaid in className (could be "language-mermaid" or contain it)
  const isMermaid = className?.includes('language-mermaid') || className === 'mermaid'

  if (isMermaid) {
    const codeContent = getTextContent(children)
    return <MermaidDiagram code={codeContent} />
  }

  return <code className={className}>{children}</code>
}

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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false)

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
    setShowMarkdownPreview(false)

    // Auto-collapse sidebar on mobile when selecting a file
    const isMobile = window.matchMedia('(max-width: 767px)').matches
    if (isMobile) {
      setSidebarCollapsed(true)
    }

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

  // Syntax highlight with fallback for unknown languages
  const getHighlightedCode = useCallback((content: string, language: string): string => {
    try {
      if (hljs.getLanguage(language)) {
        return hljs.highlight(content, { language, ignoreIllegals: true }).value
      }
      return hljs.highlightAuto(content).value
    } catch {
      return content
    }
  }, [])

  // Navigate to a directory from breadcrumb
  const navigateToDir = useCallback((dirPath: string) => {
    // Expand all directories up to and including this path
    const parts = dirPath.split('/')
    const newExpanded = new Set<string>()
    let currentPath = ''
    for (const part of parts) {
      currentPath = currentPath ? `${currentPath}/${part}` : part
      newExpanded.add(currentPath)
    }
    setExpandedDirs(newExpanded)
    setSelectedFile(null)
  }, [])

  // Render breadcrumb for current file path
  const renderBreadcrumb = useCallback((path: string) => {
    const parts = path.split('/')
    const segments: { name: string; path: string }[] = []

    let currentPath = ''
    for (let i = 0; i < parts.length; i++) {
      currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
      segments.push({ name: parts[i], path: currentPath })
    }

    return (
      <div className="flex items-center gap-1 flex-wrap">
        <span className="text-yellow-400">📁</span>
        {segments.map((segment, i) => (
          <span key={segment.path} className="flex items-center">
            {i < segments.length - 1 ? (
              <>
                <button
                  onClick={() => navigateToDir(segment.path)}
                  className="text-blue-400 hover:text-blue-300 hover:underline"
                >
                  {segment.name}
                </button>
                <span className="text-gray-500 mx-1">›</span>
              </>
            ) : (
              <span className="text-gray-300">{segment.name}</span>
            )}
          </span>
        ))}
      </div>
    )
  }, [navigateToDir])

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
      {!sidebarCollapsed && (
        <div className="w-64 flex-shrink-0 border-r border-gray-700 overflow-auto">
          <div className="p-2 bg-gray-800 border-b border-gray-700 flex justify-between items-center">
            <span className="text-sm text-gray-400">Files</span>
            <div className="flex gap-1">
              <button
                onClick={() => fetchFiles()}
                className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
                title="Refresh"
              >
                ↻
              </button>
              <button
                onClick={() => setSidebarCollapsed(true)}
                className="text-xs px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded"
                title="Collapse sidebar"
              >
                ◀
              </button>
            </div>
          </div>
          <div className="py-1">
            {renderTree(tree, '', 0)}
          </div>
        </div>
      )}

      {/* File content viewer */}
      <div className="flex-1 overflow-auto">
        {loadingFile ? (
          <div className="flex items-center justify-center h-full text-gray-500">
            Loading file...
          </div>
        ) : selectedFile ? (
          <div className="h-full flex flex-col">
            <div className="p-2 bg-gray-800 border-b border-gray-700 flex items-center justify-between">
              <div className="font-mono text-sm flex items-center gap-2">
                {sidebarCollapsed && (
                  <button
                    onClick={() => setSidebarCollapsed(false)}
                    className="text-gray-400 hover:text-gray-200 px-1"
                    title="Show file tree"
                  >
                    ▶
                  </button>
                )}
                {renderBreadcrumb(selectedFile.path)}
              </div>
              <div className="flex items-center gap-2">
                {selectedFile.path.endsWith('.md') && (
                  <button
                    onClick={() => setShowMarkdownPreview(!showMarkdownPreview)}
                    className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white"
                    title={showMarkdownPreview ? "Show code" : "Preview markdown"}
                  >
                    {showMarkdownPreview ? 'Code' : 'Preview'}
                  </button>
                )}
                <span className="text-gray-500 text-xs">
                  {selectedFile.language}
                </span>
              </div>
            </div>
            {showMarkdownPreview && selectedFile.path.endsWith('.md') ? (
              <div className="flex-1 overflow-auto p-4 md:p-8">
                <div className="max-w-4xl mx-auto">
                  <MarkdownPreview
                    source={selectedFile.content}
                    style={{
                      backgroundColor: 'transparent',
                      color: '#e5e7eb',
                    }}
                    wrapperElement={{
                      'data-color-mode': 'dark',
                    }}
                    components={{
                      code: Code,
                    }}
                  />
                </div>
              </div>
            ) : (
              <pre className="flex-1 p-4 overflow-auto text-sm font-mono">
                <code
                  className="hljs"
                  dangerouslySetInnerHTML={{
                    __html: getHighlightedCode(selectedFile.content, selectedFile.language)
                  }}
                />
              </pre>
            )}
          </div>
        ) : (
          <div className="h-full flex flex-col">
            {sidebarCollapsed && (
              <div className="p-2 bg-gray-800 border-b border-gray-700">
                <button
                  onClick={() => setSidebarCollapsed(false)}
                  className="text-gray-400 hover:text-gray-200 px-1"
                  title="Show file tree"
                >
                  ▶
                </button>
              </div>
            )}
            <div className="flex-1 flex items-center justify-center text-gray-500">
              Select a file to view
            </div>
          </div>
        )}
      </div>

    </div>
  )
}
