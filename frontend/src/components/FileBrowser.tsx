import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react'
import hljs from 'highlight.js'
import hljsDarkUrl from 'highlight.js/styles/github-dark.css?url'
import hljsLightUrl from 'highlight.js/styles/github.css?url'
import MarkdownPreview from '@uiw/react-markdown-preview'
import mermaid from 'mermaid'
import CsvViewer from './CsvViewer'
import ResizablePanes from './ResizablePanes'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FileText,
  RefreshCw,
  PanelLeftClose,
  Play,
} from 'lucide-react'
import { getApiBase } from '../config'
import { useTheme } from '../hooks/useTheme'
import { useIsDesktop } from '../hooks/useMediaQuery'

// Initialize mermaid
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
      mermaid
        .render(id, code)
        .then(({ svg }) => {
          if (ref.current) {
            ref.current.innerHTML = svg
          }
        })
        .catch((err) => {
          if (ref.current) {
            ref.current.innerHTML = `<pre class="text-danger p-4">Mermaid error: ${err.message}</pre>`
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

// Memoized code block so parent re-renders (e.g. selection state) don't recreate DOM nodes
const HighlightedCode = React.memo(function HighlightedCode({
  content,
  language,
  getHighlightedCode,
}: {
  content: string
  language: string
  getHighlightedCode: (content: string, language: string) => string
}) {
  const html = useMemo(
    () => getHighlightedCode(content, language),
    [content, language, getHighlightedCode]
  )
  return <code className="hljs" dangerouslySetInnerHTML={{ __html: html }} />
})

interface FileEntry {
  path: string
  type: 'file' | 'directory'
  size: number | null
}

// Build the files-listing URL for one directory level (root when path is '').
function filesUrl(sessionName: string | undefined, path: string): string {
  const base = sessionName
    ? `${getApiBase()}/sessions/${sessionName}/files`
    : `${getApiBase()}/files`
  return path ? `${base}?path=${encodeURIComponent(path)}` : base
}

// Updater that removes a directory's error once its refetch succeeds.
function clearDirError(path: string) {
  return (prev: Map<string, string>) => {
    if (!prev.has(path)) return prev
    const next = new Map(prev)
    next.delete(path)
    return next
  }
}

interface FileContent {
  content: string
  language: string
  path: string
}

const IMAGE_EXTENSIONS = new Set([
  '.png',
  '.jpg',
  '.jpeg',
  '.gif',
  '.svg',
  '.webp',
  '.ico',
  '.bmp',
  '.avif',
])

function isImagePath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return IMAGE_EXTENSIONS.has(ext)
}

// Resolve the backend's extension hint (e.g. 'py', 'feature') to a friendly
// label via highlight.js's alias table; fall back to the raw hint.
function languageLabel(hint: string): string {
  return hljs.getLanguage(hint)?.name ?? hint
}

function isCsvPath(path: string): boolean {
  const ext = path.slice(path.lastIndexOf('.')).toLowerCase()
  return ext === '.csv' || ext === '.tsv'
}

function csvDelimiter(path: string): string {
  return path.toLowerCase().endsWith('.tsv') ? '\t' : ''
}

function FileContentBody({
  selectedFile,
  sessionName,
  showMarkdownPreview,
  showCsvPreview,
  theme,
  contentRef,
  getHighlightedCode,
}: {
  selectedFile: FileContent
  sessionName?: string
  showMarkdownPreview: boolean
  showCsvPreview: boolean
  theme: 'dark' | 'light'
  contentRef: React.RefObject<HTMLPreElement | null>
  getHighlightedCode: (content: string, language: string) => string
}) {
  if (isImagePath(selectedFile.path)) {
    return (
      <div className="flex-1 overflow-auto flex items-center justify-center p-4 bg-[repeating-conic-gradient(#80808018_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]">
        <img
          src={`${getApiBase()}${sessionName ? `/sessions/${sessionName}/files/${selectedFile.path}` : `/files/${selectedFile.path}`}?raw=1`}
          alt={selectedFile.path}
          crossOrigin="anonymous"
          className="max-w-full max-h-full object-contain"
        />
      </div>
    )
  }

  if (isCsvPath(selectedFile.path) && showCsvPreview) {
    return <CsvViewer content={selectedFile.content} delimiter={csvDelimiter(selectedFile.path)} />
  }

  if (showMarkdownPreview && selectedFile.path.endsWith('.md')) {
    return (
      <div className="flex-1 overflow-auto p-4 md:p-8">
        <div className="max-w-4xl mx-auto">
          <MarkdownPreview
            source={selectedFile.content}
            style={{
              backgroundColor: 'transparent',
              color: theme === 'dark' ? '#e5e7eb' : '#073642',
            }}
            wrapperElement={{
              'data-color-mode': theme,
            }}
            components={{
              code: Code,
            }}
          />
        </div>
      </div>
    )
  }

  return (
    <pre className="flex-1 p-4 overflow-auto text-sm font-mono" ref={contentRef}>
      <HighlightedCode
        content={selectedFile.content}
        language={selectedFile.language}
        getHighlightedCode={getHighlightedCode}
      />
    </pre>
  )
}

function FileContentView({
  selectedFile,
  sessionName,
  sidebarCollapsed,
  showMarkdownPreview,
  showCsvPreview,
  theme,
  contentRef,
  getHighlightedCode,
  onSendPathToTerminal,
  onToggleSidebar,
  onTogglePreview,
  onToggleCsvPreview,
  renderBreadcrumb,
}: {
  selectedFile: FileContent
  sessionName?: string
  sidebarCollapsed: boolean
  showMarkdownPreview: boolean
  showCsvPreview: boolean
  theme: 'dark' | 'light'
  contentRef: React.RefObject<HTMLPreElement | null>
  getHighlightedCode: (content: string, language: string) => string
  onSendPathToTerminal: () => void
  onToggleSidebar: () => void
  onTogglePreview: () => void
  onToggleCsvPreview: () => void
  renderBreadcrumb: (path: string) => React.ReactNode
}) {
  const isCsv = isCsvPath(selectedFile.path)
  return (
    <div className="h-full flex flex-col">
      <div className="p-2 bg-bg-surface border-b border-border-default flex items-center justify-between">
        <div className="font-mono text-sm flex items-center gap-2">
          {sidebarCollapsed && (
            <button
              onClick={onToggleSidebar}
              className="text-text-tertiary hover:text-text-secondary px-1"
              title="Show file tree"
            >
              <ChevronRight size={16} />
            </button>
          )}
          {renderBreadcrumb(selectedFile.path)}
        </div>
        <div className="flex items-center gap-2">
          {sessionName && (
            <button
              onClick={onSendPathToTerminal}
              className="text-xs px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded text-text-secondary"
              title="Send file path to terminal"
            >
              Send Path
            </button>
          )}
          {selectedFile.path.endsWith('.md') && (
            <button
              onClick={onTogglePreview}
              className="text-xs px-2 py-1 bg-action hover:brightness-110 rounded text-white"
              title={showMarkdownPreview ? 'Show code' : 'Preview markdown'}
            >
              {showMarkdownPreview ? 'Code' : 'Preview'}
            </button>
          )}
          {isCsv && (
            <button
              onClick={onToggleCsvPreview}
              className="text-xs px-2 py-1 bg-action hover:brightness-110 rounded text-white"
              title={showCsvPreview ? 'Show raw text' : 'Show as table'}
            >
              {showCsvPreview ? 'Raw' : 'Table'}
            </button>
          )}
          <span className="text-text-muted text-xs">{languageLabel(selectedFile.language)}</span>
        </div>
      </div>
      <FileContentBody
        selectedFile={selectedFile}
        sessionName={sessionName}
        showMarkdownPreview={showMarkdownPreview}
        showCsvPreview={showCsvPreview}
        theme={theme}
        contentRef={contentRef}
        getHighlightedCode={getHighlightedCode}
      />
    </div>
  )
}

interface Props {
  sessionName?: string
  onFocusTerminal?: () => void
}

export default function FileBrowser({ sessionName, onFocusTerminal }: Props) {
  const { theme } = useTheme()
  const isDesktop = useIsDesktop()
  const [dirs, setDirs] = useState<Map<string, FileEntry[]>>(new Map())
  const [loadingDirs, setLoadingDirs] = useState<Set<string>>(new Set())
  const [dirErrors, setDirErrors] = useState<Map<string, string>>(new Map())
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [selectedFile, setSelectedFile] = useState<FileContent | null>(null)
  const [loadingFile, setLoadingFile] = useState(false)
  const [expandedDirs, setExpandedDirs] = useState<Set<string>>(new Set())
  const [sidebarCollapsed, setSidebarCollapsed] = useState(false)
  const [rootDir, setRootDir] = useState('')
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false)
  const [showCsvPreview, setShowCsvPreview] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [buttonPos, setButtonPos] = useState({ top: 0, left: 0 })
  const selectedTextRef = useRef('')
  const contentRef = useRef<HTMLPreElement>(null)
  const sendButtonRef = useRef<HTMLButtonElement>(null)
  // Liveness and visibility are deliberately separate. A selection can be live
  // while its button is hidden (scrolled out of the preview's box), and the
  // scroll handler has to keep recomputing in exactly that state so scrolling
  // back brings the button with it -- 'selectionchange' does not fire on
  // scroll, so nothing else would ever restore it.
  const selectionLiveRef = useRef(false)

  // Track text selection in the content area
  const handleSelectionChange = useCallback(() => {
    const selection = window.getSelection()
    if (!selection || selection.rangeCount === 0) {
      selectionLiveRef.current = false
      setHasSelection(false)
      return
    }

    const range = selection.getRangeAt(0)
    const inContainer = contentRef.current?.contains(range.commonAncestorContainer)

    // Read collapsed state and geometry off the Range, not
    // `selection.toString()`. While ResizablePanes' splitter drag is in
    // progress it sets `document.body.style.userSelect = 'none'` on <body>,
    // under which `Selection.toString()` reads back empty even though the
    // Range itself -- and its `getBoundingClientRect()` -- is untouched.
    // Reading the Range directly means a mid-drag recompute (scroll, resize,
    // the ResizeObserver below) still sees and positions the real selection
    // instead of treating it as gone, so nothing extra is needed to recover
    // once the drag ends.
    selectionLiveRef.current = Boolean(inContainer) && !range.collapsed
    if (!selectionLiveRef.current) {
      setHasSelection(false)
      return
    }

    const text = selection.toString()
    if (text) selectedTextRef.current = text

    const rangeRect = range.getBoundingClientRect()
    const preRect = contentRef.current!.getBoundingClientRect()

    // The button is `position: fixed`, so it does not scroll or clip with the
    // preview. Once the selection has scrolled out of the preview's box the
    // button must go away rather than park itself at the clamp boundary --
    // where it would sit on top of the panel's tab bar and eat its clicks.
    if (rangeRect.bottom < preRect.top || rangeRect.top > preRect.bottom) {
      setHasSelection(false)
      return
    }

    // Anchor to the selection itself, not the container: the container can
    // span the full maximized panel while the selected text sits far to
    // its left, which would otherwise strand the button at the pane edge.
    const buttonWidth = sendButtonRef.current?.offsetWidth ?? 30
    const left = Math.min(rangeRect.right + 8, window.innerWidth - buttonWidth - 8)
    setButtonPos({
      top: Math.max(rangeRect.top - 32, preRect.top),
      left,
    })
    setHasSelection(true)
  }, [])

  useEffect(() => {
    // 'scroll' is registered with capture: true because the scrolling element
    // is the inner <pre> (overflow-auto), whose scroll events don't bubble to
    // document. Window 'resize' covers browser-window resizes. Neither one
    // fires when the tree splitter is dragged though -- that only changes an
    // inline width percentage, not the window size -- so a ResizeObserver on
    // the <pre> itself catches that (and any other reflow that changes the
    // preview pane's box) regardless of what caused it, including a touch
    // drag (which fires no compatibility mouse events at all, since
    // ResizablePanes' touch handler calls preventDefault()).
    // The capture-phase listener sees every scroll on the page, including the
    // virtualized conversation feed in the other pane, so it bails before
    // measuring anything unless there is a live selection to reposition.
    const handleScroll = () => {
      if (!selectionLiveRef.current) return
      handleSelectionChange()
    }

    document.addEventListener('selectionchange', handleSelectionChange)
    document.addEventListener('scroll', handleScroll, true)
    window.addEventListener('resize', handleSelectionChange)

    // contentRef.current is only non-null once a file is selected and rendered
    // in its default (non-image/csv/markdown) code view, so this effect must
    // re-run whenever that can change to (re)attach the observer.
    const preEl = contentRef.current
    const resizeObserver = preEl ? new ResizeObserver(handleSelectionChange) : null
    if (preEl && resizeObserver) resizeObserver.observe(preEl)

    return () => {
      document.removeEventListener('selectionchange', handleSelectionChange)
      document.removeEventListener('scroll', handleScroll, true)
      window.removeEventListener('resize', handleSelectionChange)
      resizeObserver?.disconnect()
    }
  }, [handleSelectionChange, selectedFile, showMarkdownPreview, showCsvPreview])

  // Re-initialize mermaid when theme changes
  useEffect(() => {
    mermaid.initialize({
      startOnLoad: false,
      theme: theme === 'dark' ? 'dark' : 'default',
      securityLevel: 'loose',
    })
  }, [theme])

  // Swap highlight.js stylesheet based on theme
  useEffect(() => {
    const id = 'hljs-theme'
    let link = document.getElementById(id) as HTMLLinkElement | null
    if (!link) {
      link = document.createElement('link')
      link.id = id
      link.rel = 'stylesheet'
      document.head.appendChild(link)
    }
    link.href = theme === 'dark' ? hljsDarkUrl : hljsLightUrl
  }, [theme])

  const handleSendPathToTerminal = async () => {
    if (!selectedFile || !sessionName) return
    const fullPath = rootDir ? `${rootDir}/${selectedFile.path}` : selectedFile.path

    try {
      const response = await fetch(`${getApiBase()}/session/${sessionName}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: fullPath, send_enter: false }),
      })
      if (!response.ok) {
        console.error('Failed to send to terminal:', await response.text())
      }
      onFocusTerminal?.()
    } catch (err) {
      console.error('Failed to send to terminal:', err)
    }
  }

  const handleSendToTerminal = async () => {
    const text = selectedTextRef.current
    if (!text || !sessionName) return

    let message = text
    if (selectedFile) {
      const fullPath = rootDir ? `${rootDir}/${selectedFile.path}` : selectedFile.path
      const offset = selectedFile.content.indexOf(text)
      if (offset !== -1) {
        const startLine = selectedFile.content.substring(0, offset).split('\n').length
        const endLine = startLine + text.split('\n').length - 1
        message = `From ${fullPath}:${startLine}-${endLine}:\n${text}`
      } else {
        message = `From ${fullPath}:\n${text}`
      }
    }

    try {
      const response = await fetch(`${getApiBase()}/session/${sessionName}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: message, send_enter: false }),
      })
      if (!response.ok) {
        console.error('Failed to send to terminal:', await response.text())
      }
      onFocusTerminal?.()
    } catch (err) {
      console.error('Failed to send to terminal:', err)
    }
  }

  const fetchDir = useCallback(
    async (path = '', silent = false) => {
      const isRoot = path === ''
      const rootUI = !silent && isRoot
      if (rootUI) {
        setLoading(true)
        setError(null)
      }
      if (!isRoot) setLoadingDirs((prev) => new Set(prev).add(path))
      try {
        const url = filesUrl(sessionName, path)
        const res = await fetch(url)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        setDirs((prev) => new Map(prev).set(path, json.files))
        if (!isRoot) setDirErrors(clearDirError(path))
        if (json.root) setRootDir(json.root)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Failed to fetch files'
        if (isRoot) {
          // Only a failed root fetch may blank the panel.
          if (!silent) setError(message)
        } else {
          // A failed subdirectory surfaces on its own row and leaves every
          // already-loaded directory intact.
          setDirErrors((prev) => new Map(prev).set(path, message))
        }
      } finally {
        if (rootUI) setLoading(false)
        if (!isRoot) {
          setLoadingDirs((prev) => {
            const next = new Set(prev)
            next.delete(path)
            return next
          })
        }
      }
    },
    [sessionName]
  )

  // Auto-refresh reads the live expanded set through a ref so the interval is
  // not torn down and rebuilt every time a folder is opened.
  const expandedRef = useRef(expandedDirs)
  useEffect(() => {
    expandedRef.current = expandedDirs
  }, [expandedDirs])

  // Reset state when session changes
  useEffect(() => {
    setSelectedFile(null)
    setExpandedDirs(new Set())
    setDirs(new Map())
  }, [sessionName])

  useEffect(() => {
    fetchDir('')

    // Auto-refresh every 5 seconds: root plus whatever is expanded. Collapsed
    // directories are not on screen, so they are not refetched. Results merge
    // into the map rather than replacing it, or the tree would remount each tick.
    const interval = setInterval(() => {
      fetchDir('', true)
      expandedRef.current.forEach((p) => fetchDir(p, true))
    }, 5000)

    return () => clearInterval(interval)
  }, [fetchDir])

  const fetchFileContent = async (path: string) => {
    setLoadingFile(true)
    setShowMarkdownPreview(path.endsWith('.md'))
    setShowCsvPreview(isCsvPath(path))
    selectionLiveRef.current = false
    setHasSelection(false)

    // Auto-collapse sidebar on mobile when selecting a file
    const isMobile = window.matchMedia('(max-width: 767px)').matches
    if (isMobile) {
      setSidebarCollapsed(true)
    }

    try {
      // Use session-scoped endpoint if sessionName is provided
      const url = sessionName
        ? `${getApiBase()}/sessions/${sessionName}/files/${encodeURIComponent(path)}`
        : `${getApiBase()}/files/${encodeURIComponent(path)}`
      const res = await fetch(url)
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
    const opening = !expandedDirs.has(path)
    setExpandedDirs((prev) => {
      const next = new Set(prev)
      if (next.has(path)) {
        next.delete(path)
      } else {
        next.add(path)
      }
      return next
    })
    if (opening && !dirs.has(path)) {
      fetchDir(path)
    }
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

    return sorted.map((entry) => {
      const name = entry.path.split('/').pop() || entry.path
      const isExpanded = expandedDirs.has(entry.path)

      if (entry.type === 'directory') {
        return (
          <div key={entry.path} data-testid="file-entry">
            <button
              onClick={() => toggleDir(entry.path)}
              className="w-full flex items-center gap-2 px-2 py-1 hover:bg-bg-surface text-left"
              style={{ paddingLeft: `${depth * 16 + 8}px` }}
            >
              {loadingDirs.has(entry.path) ? (
                <RefreshCw size={14} className="text-text-muted animate-spin" />
              ) : isExpanded ? (
                <ChevronDown size={14} className="text-text-muted" />
              ) : (
                <ChevronRight size={14} className="text-text-muted" />
              )}
              <Folder size={16} className="text-warning" />
              <span className="text-text-secondary truncate">{name}</span>
            </button>
            {isExpanded && renderTree(tree, entry.path, depth + 1)}
            {isExpanded && dirErrors.has(entry.path) && (
              <div
                className="text-xs text-danger px-2 py-1"
                style={{ paddingLeft: `${(depth + 1) * 16 + 8}px` }}
              >
                {dirErrors.get(entry.path)}
              </div>
            )}
          </div>
        )
      }

      return (
        <button
          key={entry.path}
          onClick={() => fetchFileContent(entry.path)}
          data-testid="file-entry"
          className={`w-full flex items-center gap-2 px-2 py-1 hover:bg-bg-surface text-left ${
            selectedFile?.path === entry.path ? 'bg-control-bg' : ''
          }`}
          style={{ paddingLeft: `${depth * 16 + 8}px` }}
        >
          <span className="text-text-muted text-xs opacity-0 w-3.5" />
          <FileText size={16} className="text-text-muted" />
          <span className="text-text-secondary truncate">{name}</span>
          {entry.size !== null && (
            <span className="text-text-muted text-xs ml-auto">{formatSize(entry.size)}</span>
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
  const renderBreadcrumb = useCallback(
    (path: string) => {
      const parts = path.split('/')
      const segments: { name: string; path: string }[] = []

      let currentPath = ''
      for (let i = 0; i < parts.length; i++) {
        currentPath = currentPath ? `${currentPath}/${parts[i]}` : parts[i]
        segments.push({ name: parts[i], path: currentPath })
      }

      return (
        <div className="flex items-center gap-1 flex-wrap">
          <Folder size={16} className="text-warning" />
          {segments.map((segment, i) => (
            <span key={segment.path} className="flex items-center">
              {i < segments.length - 1 ? (
                <>
                  <button
                    onClick={() => navigateToDir(segment.path)}
                    className="text-action hover:text-action/80 hover:underline"
                  >
                    {segment.name}
                  </button>
                  <ChevronRight size={14} className="text-text-muted mx-1" />
                </>
              ) : (
                <span className="text-text-secondary">{segment.name}</span>
              )}
            </span>
          ))}
        </div>
      )
    },
    [navigateToDir]
  )

  const manualRefresh = () => {
    const expanded = Array.from(expandedDirs)
    setDirs(new Map())
    fetchDir('')
    expanded.forEach((p) => fetchDir(p))
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        Loading files...
      </div>
    )
  }

  if (error) {
    return (
      <div className="flex flex-col items-center justify-center h-full gap-4">
        <span className="text-danger">Error: {error}</span>
        <button
          onClick={manualRefresh}
          className="px-4 py-2 bg-action hover:brightness-110 rounded text-white"
        >
          Retry
        </button>
      </div>
    )
  }

  const treeSidebar = (
    <div className="border-r border-border-default overflow-auto h-full">
      <div className="p-2 bg-bg-surface border-b border-border-default flex justify-between items-center">
        <span className="text-sm text-text-tertiary">Files</span>
        <div className="flex gap-1">
          <button
            onClick={manualRefresh}
            className="text-xs px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded"
            title="Refresh"
          >
            <RefreshCw size={14} />
          </button>
          <button
            onClick={() => setSidebarCollapsed(true)}
            className="text-xs px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded"
            title="Collapse sidebar"
          >
            <PanelLeftClose size={14} />
          </button>
        </div>
      </div>
      <div className="py-1">{renderTree(dirs, '', 0)}</div>
    </div>
  )

  const contentViewer = (
    <div className="flex-1 overflow-auto relative h-full" data-testid="file-preview">
      {loadingFile ? (
        <div className="flex items-center justify-center h-full text-text-muted">
          Loading file...
        </div>
      ) : selectedFile ? (
        <FileContentView
          selectedFile={selectedFile}
          sessionName={sessionName}
          sidebarCollapsed={sidebarCollapsed}
          showMarkdownPreview={showMarkdownPreview}
          showCsvPreview={showCsvPreview}
          theme={theme}
          contentRef={contentRef}
          getHighlightedCode={getHighlightedCode}
          onSendPathToTerminal={handleSendPathToTerminal}
          onToggleSidebar={() => setSidebarCollapsed(false)}
          onTogglePreview={() => setShowMarkdownPreview(!showMarkdownPreview)}
          onToggleCsvPreview={() => setShowCsvPreview(!showCsvPreview)}
          renderBreadcrumb={renderBreadcrumb}
        />
      ) : (
        <div className="h-full flex flex-col">
          {sidebarCollapsed && (
            <div className="p-2 bg-bg-surface border-b border-border-default">
              <button
                onClick={() => setSidebarCollapsed(false)}
                className="text-text-tertiary hover:text-text-secondary px-1"
                title="Show file tree"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <div className="flex-1 flex items-center justify-center text-text-muted">
            Select a file to view
          </div>
        </div>
      )}
    </div>
  )

  // A draggable splitter only makes sense where there is width to spare: on a
  // phone the tree keeps its original fixed 256px, with no splitter to
  // fat-finger and nothing for a drag to shrink it below.
  return (
    <div className="h-full">
      {isDesktop ? (
        <ResizablePanes
          collapse={sidebarCollapsed ? 'left' : null}
          storageKey="lumbergh:filesTreeWidth"
          defaultLeftWidth={25}
          minLeftWidth={10}
          maxLeftWidth={50}
          left={treeSidebar}
          right={contentViewer}
        />
      ) : (
        <div className="h-full flex">
          {!sidebarCollapsed && <div className="w-64 flex-shrink-0">{treeSidebar}</div>}
          {contentViewer}
        </div>
      )}
      {sessionName && (
        <button
          ref={sendButtonRef}
          onMouseDown={(e) => {
            e.preventDefault()
            handleSendToTerminal()
          }}
          className="z-50 text-lg bg-action hover:brightness-110 text-white rounded px-1.5 py-0.5 pointer-events-auto"
          style={{
            position: 'fixed',
            top: buttonPos.top,
            left: buttonPos.left,
            visibility: hasSelection ? 'visible' : 'hidden',
          }}
          title="Send selected text to terminal (no Enter)"
        >
          <Play size={18} />
        </button>
      )}
    </div>
  )
}
