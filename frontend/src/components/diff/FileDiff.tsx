import { useState, useEffect, useCallback, useRef, useMemo, memo } from 'react'
import { DiffView, DiffModeEnum } from '@git-diff-view/react'
import type { DiffFile } from './types'
import { extractDiffContent, getFileStats, getLangFromPath } from './utils'
import MarkdownViewer from '../MarkdownViewer'

interface Props {
  file: DiffFile
  onBack: () => void
  apiHost?: string
  sessionName?: string
  onFocusTerminal?: () => void
}

const FONT_SIZE_KEY = 'diff-font-size'
const DEFAULT_FONT_SIZE = 14
const MIN_FONT_SIZE = 8
const MAX_FONT_SIZE = 20
const FONT_SIZE_STEP = 2

const FileDiff = memo(function FileDiff({
  file,
  onBack,
  apiHost,
  sessionName,
  onFocusTerminal,
}: Props) {
  const [showMarkdownPreview, setShowMarkdownPreview] = useState(false)
  const [hasSelection, setHasSelection] = useState(false)
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
    if (selection && contentRef.current?.contains(selection.anchorNode)) {
      const text = selection.toString()
      selectedTextRef.current = text
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
    if (!text || !sessionName || !apiHost) return

    try {
      const response = await fetch(`http://${apiHost}/api/session/${sessionName}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, send_enter: false }),
      })
      if (!response.ok) {
        console.error('Failed to send to terminal:', await response.text())
      }
      onFocusTerminal?.()
    } catch (err) {
      console.error('Failed to send to terminal:', err)
    }
  }

  return (
    <div className="h-full flex flex-col">
      {/* Breadcrumb header */}
      <div className="flex items-center gap-2 p-2 bg-gray-800 border-b border-gray-700">
        <button
          onClick={onBack}
          className="flex items-center gap-1 px-2 py-1 bg-gray-700 hover:bg-gray-600 rounded text-sm"
        >
          ← Back
        </button>
        <span className="text-gray-500">/</span>
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
            className="px-1.5 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-l"
            title="Decrease font size"
          >
            A-
          </button>
          <button
            onClick={() => changeFontSize(FONT_SIZE_STEP)}
            disabled={fontSize >= MAX_FONT_SIZE}
            className="px-1.5 py-0.5 text-xs bg-gray-700 hover:bg-gray-600 disabled:opacity-30 disabled:cursor-not-allowed rounded-r"
            title="Increase font size"
          >
            A+
          </button>
        </div>
      </div>

      {/* Diff viewer */}
      <div className="flex-1 overflow-auto relative diff-font-size-override" ref={contentRef} style={{ color: 'unset', '--diff-font-size': `${fontSize}px` } as React.CSSProperties}>
        {hasSelection && sessionName && (
          <button
            onMouseDown={(e) => {
              e.preventDefault()
              handleSendToTerminal()
            }}
            className="absolute top-2 right-4 z-10 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded"
            title="Send selected text to terminal (no Enter)"
          >
            Send to Terminal
          </button>
        )}
        {hunks.length > 0 ? (
          <DiffView
            data={diffViewData}
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
