import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import { highlighter } from '@git-diff-view/lowlight'
import { _cacheMap } from '@git-diff-view/core'
import { ArrowLeft, Play, Maximize2 } from 'lucide-react'
import { getApiBase } from '../../config'
import type { DiffFile } from './types'
import { extractDiffContent, getFileStats, getLangFromPath } from './utils'
import MarkdownViewer from '../MarkdownViewer'
import { useTheme } from '../../hooks/useTheme'

// Disable the global File cache in @git-diff-view/core.
// The cache causes a bug where syntax highlighting is lost on re-mount:
// cached File objects carry stale highlighter metadata that tricks DiffView
// into skipping initSyntax() on subsequent renders.
_cacheMap.setMaxLength(0)

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

interface Props {
  file: DiffFile
  onBack: () => void
  sessionName?: string
  onFocusTerminal?: () => void
  onCloseExpanded?: () => void
  onExpand?: () => void
}

const FONT_SIZE_KEY = 'diff-font-size'
const DEFAULT_FONT_SIZE = 14
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 20
const FONT_SIZE_STEP = 2

const FileDiff = memo(function FileDiff({
  file,
  onBack,
  sessionName,
  onFocusTerminal,
  onCloseExpanded,
  onExpand,
}: Props) {
  const { theme } = useTheme()
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
  const [buttonPos, setButtonPos] = useState({ top: 0 })
  const [fontSize, setFontSize] = useState(() => {
    const stored = localStorage.getItem(FONT_SIZE_KEY)
    return stored ? Number(stored) : DEFAULT_FONT_SIZE
  })
  const selectedTextRef = useRef('')
  const contentRef = useRef<HTMLDivElement>(null)

  const changeFontSize = useCallback((delta: number) => {
    setFontSize((prev) => {
      const next = Math.min(MAX_FONT_SIZE, Math.max(MIN_FONT_SIZE, prev + delta))
      localStorage.setItem(FONT_SIZE_KEY, String(next))
      return next
    })
  }, [])

  // Memoize computed values to prevent recalculation on every render
  const hunks = useMemo(() => extractDiffContent(file.diff), [file.diff])
  const lang = useMemo(() => getLangFromPath(file.path), [file.path])
  const stats = useMemo(() => getFileStats(file.diff), [file.diff])
  // Use content from backend (full file content for proper syntax highlighting)
  const oldContent = file.oldContent ?? ''
  const newContent = file.newContent ?? ''
  const isMarkdown = file.path.endsWith('.md')

  // Memoize the data prop to prevent re-renders of DiffView
  const diffViewData = useMemo(
    () => ({
      oldFile: { fileName: file.path, fileLang: lang, content: oldContent },
      newFile: { fileName: file.path, fileLang: lang, content: newContent },
      hunks: hunks,
    }),
    [file.path, lang, oldContent, newContent, hunks]
  )

  // Track text selection in the diff area
  const handleSelectionChange = useCallback(() => {
    const selection = window.getSelection()
    if (
      selection &&
      selection.rangeCount > 0 &&
      contentRef.current?.contains(selection.anchorNode)
    ) {
      const text = selection.toString()
      selectedTextRef.current = text
      if (text.length > 0) {
        const range = selection.getRangeAt(0)
        const rangeRect = range.getBoundingClientRect()
        const containerRect = contentRef.current.getBoundingClientRect()
        const top = rangeRect.top - containerRect.top + contentRef.current.scrollTop - 32
        setButtonPos({ top: Math.max(0, top) })
      }
      setHasSelection(text.length > 0)
    } else {
      setHasSelection(false)
    }
  }, [])

  useEffect(() => {
    document.addEventListener('selectionchange', handleSelectionChange)
    return () => document.removeEventListener('selectionchange', handleSelectionChange)
  }, [handleSelectionChange])

  const handleSendToTerminal = async () => {
    const text = selectedTextRef.current
    if (!text || !sessionName) return

    let message = text
    let offset = newContent.indexOf(text)
    let source = newContent
    if (offset === -1) {
      offset = oldContent.indexOf(text)
      source = oldContent
    }
    if (offset !== -1) {
      const startLine = source.substring(0, offset).split('\n').length
      const endLine = startLine + text.split('\n').length - 1
      message = `From ${file.path}:${startLine}-${endLine}:\n${text}`
    } else {
      message = `From ${file.path}:\n${text}`
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
      onCloseExpanded?.()
    } catch (err) {
      console.error('Failed to send to terminal:', err)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-2 p-2 bg-bg-surface border-b border-border-default">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2 py-1 bg-control-bg hover:bg-control-bg-hover rounded text-sm"
        >
          <ArrowLeft size={14} /> Back
        </button>
        <span className="text-text-muted">/</span>
        <span className="font-mono text-sm text-blue-400 truncate flex-1">{file.path}</span>
        {isMarkdown && (
          <button
            onClick={() => setShowMarkdownPreview(true)}
            className="text-xs px-2 py-1 bg-blue-600 hover:bg-blue-500 rounded text-white"
            title="Preview new version"
          >
            Preview
          </button>
        )}
        <span className="text-green-400 text-xs">+{stats.additions}</span>
        <span className="text-red-400 text-xs">-{stats.deletions}</span>
        <div className="flex items-center gap-0.5 ml-1">
          <button
            onClick={() => changeFontSize(-FONT_SIZE_STEP)}
            disabled={fontSize <= MIN_FONT_SIZE}
            className="px-1.5 py-0.5 text-xs bg-control-bg hover:bg-control-bg-hover disabled:opacity-30 disabled:cursor-not-allowed rounded-l"
            title="Decrease font size"
          >
            A-
          </button>
          <button
            onClick={() => changeFontSize(FONT_SIZE_STEP)}
            disabled={fontSize >= MAX_FONT_SIZE}
            className="px-1.5 py-0.5 text-xs bg-control-bg hover:bg-control-bg-hover disabled:opacity-30 disabled:cursor-not-allowed rounded-r"
            title="Increase font size"
          >
            A+
          </button>
        </div>
        {onExpand && (
          <button
            onClick={onExpand}
            className="px-1.5 py-0.5 text-xs bg-control-bg hover:bg-control-bg-hover rounded"
            title="Expand diff viewer"
          >
            <Maximize2 size={14} />
          </button>
        )}
      </div>

      {/* Diff viewer */}
      {isImagePath(file.path) ? (
        <div className="flex-1 overflow-auto flex items-center justify-center gap-8 p-4 bg-[repeating-conic-gradient(#80808018_0%_25%,transparent_0%_50%)] bg-[length:20px_20px]">
          {sessionName && (
            <img
              src={`${getApiBase()}/sessions/${sessionName}/files/${file.path}?raw=1`}
              alt={file.path}
              className="max-w-full max-h-full object-contain"
            />
          )}
        </div>
      ) : (
        <div
          className="flex-1 overflow-auto relative diff-font-size-override"
          ref={contentRef}
          style={{ color: 'unset', '--diff-font-size': `${fontSize}px` } as React.CSSProperties}
        >
          {hasSelection && sessionName && (
            <button
              onMouseDown={(e) => {
                e.preventDefault()
                handleSendToTerminal()
              }}
              className="z-10 text-lg bg-blue-600 hover:bg-blue-500 text-white rounded px-1.5 py-0.5"
              style={{ position: 'absolute', top: buttonPos.top, right: 16 }}
              title="Send selected text to terminal (no Enter)"
            >
              <Play size={18} />
            </button>
          )}
          {hunks.length > 0 ? (
            <DiffView
              data={diffViewData}
              diffViewMode={DiffModeEnum.Unified}
              diffViewTheme={theme}
              diffViewHighlight
              diffViewWrap
              registerHighlighter={highlighter}
            />
          ) : (
            <div className="flex items-center justify-center h-full text-text-muted">
              No diff content for this file
            </div>
          )}
        </div>
      )}

      {/* Markdown preview modal */}
      {showMarkdownPreview && isMarkdown && (
        <MarkdownViewer
          content={newContent}
          filePath={file.path}
          onClose={() => setShowMarkdownPreview(false)}
        />
      )}
    </div>
  )
})

export default FileDiff
