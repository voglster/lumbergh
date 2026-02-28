import { useState, useEffect, useCallback } from 'react'
import MarkdownViewer from './MarkdownViewer'

interface SharedFile {
  name: string
  size: number
  modified: number
}

interface Props {
  apiHost: string
  sessionName?: string
  onFocusTerminal?: () => void
  refreshTrigger?: number // Increment to trigger refresh
}

const SHARED_DIR = '~/.config/lumbergh/shared'

export default function SharedFiles({
  apiHost,
  sessionName,
  onFocusTerminal,
  refreshTrigger,
}: Props) {
  const [files, setFiles] = useState<SharedFile[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [isDragging, setIsDragging] = useState(false)
  const [uploading, setUploading] = useState(false)
  const [previewFile, setPreviewFile] = useState<SharedFile | null>(null)
  const [previewContent, setPreviewContent] = useState<string | null>(null)

  const fetchFiles = useCallback(async () => {
    try {
      const res = await fetch(`http://${apiHost}/api/shared/files`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const data = await res.json()
      setFiles(data.files || [])
      setError(null)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch files')
    } finally {
      setLoading(false)
    }
  }, [apiHost])

  // Initial load and polling
  useEffect(() => {
    fetchFiles()
    const interval = setInterval(fetchFiles, 5000)
    return () => clearInterval(interval)
  }, [fetchFiles])

  // Refresh on trigger change
  useEffect(() => {
    if (refreshTrigger !== undefined && refreshTrigger > 0) {
      fetchFiles()
    }
  }, [refreshTrigger, fetchFiles])

  const uploadFile = async (file: File) => {
    setUploading(true)
    try {
      const formData = new FormData()
      formData.append('file', file)

      const res = await fetch(`http://${apiHost}/api/shared/upload`, {
        method: 'POST',
        body: formData,
      })

      if (!res.ok) throw new Error(`Upload failed: ${res.status}`)

      await fetchFiles()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setUploading(false)
    }
  }

  const deleteFile = async (filename: string) => {
    try {
      const res = await fetch(`http://${apiHost}/api/shared/files/${encodeURIComponent(filename)}`, {
        method: 'DELETE',
      })
      if (!res.ok) throw new Error(`Delete failed: ${res.status}`)
      await fetchFiles()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Delete failed')
    }
  }

  const sendToTerminal = async (filename: string, sendEnter: boolean) => {
    if (!sessionName) return

    const path = `${SHARED_DIR}/${filename}`
    try {
      const res = await fetch(`http://${apiHost}/api/session/${sessionName}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: path, send_enter: sendEnter }),
      })
      if (!res.ok) {
        console.error('Failed to send to terminal:', await res.text())
      }
      onFocusTerminal?.()
    } catch (err) {
      console.error('Failed to send to terminal:', err)
    }
  }

  // Drag and drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(true)
  }

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    e.stopPropagation()
    setIsDragging(false)

    const items = e.dataTransfer.files
    if (items.length > 0) {
      await uploadFile(items[0])
    }
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`
  }

  const isImage = (filename: string): boolean => {
    const ext = filename.toLowerCase().split('.').pop()
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg'].includes(ext || '')
  }

  const isMarkdown = (filename: string): boolean => {
    return filename.toLowerCase().endsWith('.md')
  }

  const isTextFile = (filename: string): boolean => {
    const ext = filename.toLowerCase().split('.').pop()
    return ['txt', 'json', 'yml', 'yaml', 'py', 'js', 'ts', 'tsx', 'jsx', 'css', 'html', 'sh', 'toml', 'cfg', 'ini', 'log', 'csv', 'xml'].includes(ext || '')
  }

  const openPreview = async (file: SharedFile) => {
    if (isMarkdown(file.name) || isTextFile(file.name)) {
      try {
        const res = await fetch(`http://${apiHost}/api/shared/files/${encodeURIComponent(file.name)}`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const data = await res.json()
        setPreviewContent(data.content)
        setPreviewFile(file)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to load file')
      }
    } else if (isImage(file.name)) {
      setPreviewContent(null)
      setPreviewFile(file)
    }
  }

  const closePreview = () => {
    setPreviewFile(null)
    setPreviewContent(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-text-muted">
        Loading...
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Drop zone */}
      <div
        className={`p-4 border-2 border-dashed rounded m-2 text-center transition-colors ${
          isDragging
            ? 'border-blue-500 bg-blue-900/20'
            : 'border-border-subtle hover:border-border-subtle'
        } ${uploading ? 'opacity-50' : ''}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <span className="text-text-tertiary text-sm">
          {uploading ? 'Uploading...' : 'Drop files here or paste images'}
        </span>
      </div>

      {/* Error message */}
      {error && (
        <div className="mx-2 p-2 bg-red-900/50 text-red-300 text-sm rounded">
          {error}
        </div>
      )}

      {/* File list */}
      <div className="flex-1 overflow-auto px-2 pb-2">
        {files.length === 0 ? (
          <div className="text-center text-text-muted mt-4">
            No shared files yet
          </div>
        ) : (
          <div className="space-y-1">
            {files.map((file) => (
              <div
                key={file.name}
                className="flex items-center gap-2 p-2 bg-bg-surface rounded hover:bg-bg-surface-hover cursor-pointer"
                onClick={() => openPreview(file)}
              >
                {/* Send buttons (left side) */}
                {sessionName && (
                  <div className="flex gap-0.5 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                    <button
                      onClick={() => sendToTerminal(file.name, false)}
                      className="p-1.5 text-text-tertiary hover:text-blue-400 hover:bg-control-bg rounded"
                      title="Send path to terminal (no Enter)"
                    >
                      ▷
                    </button>
                    <button
                      onClick={() => sendToTerminal(file.name, true)}
                      className="p-1.5 text-text-tertiary hover:text-green-400 hover:bg-control-bg rounded"
                      title="Send path to terminal + Enter"
                    >
                      ➤
                    </button>
                  </div>
                )}

                {/* Thumbnail or icon */}
                <div className="w-10 h-10 flex-shrink-0 rounded overflow-hidden bg-control-bg flex items-center justify-center">
                  {isImage(file.name) ? (
                    <img
                      src={`http://${apiHost}/api/shared/files/${encodeURIComponent(file.name)}/content`}
                      alt={file.name}
                      className="w-full h-full object-cover"
                    />
                  ) : (
                    <span className="text-text-tertiary text-lg">📄</span>
                  )}
                </div>

                {/* Filename and size */}
                <div className="flex-1 min-w-0">
                  <div className="text-sm text-text-secondary truncate" title={file.name}>
                    {file.name}
                  </div>
                  <div className="text-xs text-text-muted">{formatSize(file.size)}</div>
                </div>

                {/* Action buttons (right side) */}
                <div className="flex gap-1 flex-shrink-0" onClick={(e) => e.stopPropagation()}>
                  {(isMarkdown(file.name) || isTextFile(file.name)) && (
                    <CopyTextButton apiHost={apiHost} filename={file.name} />
                  )}
                  <a
                    href={`http://${apiHost}/api/shared/files/${encodeURIComponent(file.name)}/content`}
                    download={file.name}
                    className="p-1.5 text-text-tertiary hover:text-blue-400 hover:bg-control-bg rounded"
                    title="Download file"
                  >
                    ↓
                  </a>
                  <button
                    onClick={() => deleteFile(file.name)}
                    className="p-1.5 text-text-tertiary hover:text-red-400 hover:bg-control-bg rounded"
                    title="Delete file"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
                    </svg>
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Preview modals */}
      {previewFile && isMarkdown(previewFile.name) && previewContent !== null && (
        <MarkdownViewer
          content={previewContent}
          filePath={previewFile.name}
          onClose={closePreview}
        />
      )}

      {previewFile && isImage(previewFile.name) && (
        <ImageLightbox
          src={`http://${apiHost}/api/shared/files/${encodeURIComponent(previewFile.name)}/content`}
          alt={previewFile.name}
          onClose={closePreview}
        />
      )}

      {previewFile && isTextFile(previewFile.name) && previewContent !== null && (
        <TextPreview
          content={previewContent}
          filename={previewFile.name}
          onClose={closePreview}
        />
      )}
    </div>
  )
}

function ImageLightbox({ src, alt, onClose }: { src: string; alt: string; onClose: () => void }) {
  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [onClose])

  return (
    <div
      className="fixed inset-0 bg-black/90 flex items-center justify-center z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <button
        onClick={onClose}
        className="absolute top-4 right-4 text-white/70 hover:text-white text-2xl"
        title="Close (Esc)"
      >
        ×
      </button>
      <img src={src} alt={alt} className="max-w-[90vw] max-h-[90vh] object-contain" />
    </div>
  )
}

function TextPreview({ content, filename, onClose }: { content: string; filename: string; onClose: () => void }) {
  const [copied, setCopied] = useState(false)

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose() }
    document.addEventListener('keydown', handler)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', handler)
      document.body.style.overflow = ''
    }
  }, [onClose])

  const copyText = async () => {
    await navigator.clipboard.writeText(content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className="fixed inset-0 bg-black/95 flex flex-col z-50"
      onClick={(e) => { if (e.target === e.currentTarget) onClose() }}
    >
      <div className="flex items-center justify-between p-3 bg-bg-sunken border-b border-border-default">
        <span className="font-mono text-sm text-text-secondary truncate">{filename}</span>
        <div className="flex items-center gap-2 flex-shrink-0">
          <button
            onClick={copyText}
            className="text-text-tertiary hover:text-text-primary p-1 text-sm"
            title="Copy text"
          >
            {copied ? '✓ Copied' : 'Copy'}
          </button>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary p-1"
            title="Close (Esc)"
          >
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>
      </div>
      <div className="flex-1 overflow-auto p-4 md:p-8">
        <pre className="max-w-4xl mx-auto text-sm text-text-secondary whitespace-pre-wrap break-words font-mono">
          {content}
        </pre>
      </div>
    </div>
  )
}

function CopyTextButton({ apiHost, filename }: { apiHost: string; filename: string }) {
  const [copied, setCopied] = useState(false)

  const handleCopy = async () => {
    try {
      const res = await fetch(`http://${apiHost}/api/shared/files/${encodeURIComponent(filename)}`)
      if (!res.ok) return
      const data = await res.json()
      await navigator.clipboard.writeText(data.content)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // ignore
    }
  }

  return (
    <button
      onClick={handleCopy}
      className={`p-1.5 hover:bg-control-bg rounded ${copied ? 'text-green-400' : 'text-text-tertiary hover:text-blue-400'}`}
      title={copied ? 'Copied!' : 'Copy text'}
    >
      {copied ? (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
        </svg>
      ) : (
        <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
        </svg>
      )}
    </button>
  )
}
