import { useState, useEffect, useCallback } from 'react'

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
      const file = items[0]
      if (file.type.startsWith('image/')) {
        await uploadFile(file)
      }
    }
  }

  const formatSize = (bytes: number): string => {
    if (bytes < 1024) return `${bytes}B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)}K`
    return `${(bytes / (1024 * 1024)).toFixed(1)}M`
  }

  const isImage = (filename: string): boolean => {
    const ext = filename.toLowerCase().split('.').pop()
    return ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp'].includes(ext || '')
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
          {uploading ? 'Uploading...' : 'Drop images here or paste anywhere'}
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
                className="flex items-center gap-2 p-2 bg-bg-surface rounded hover:bg-bg-surface"
              >
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

                {/* Action buttons */}
                <div className="flex gap-1 flex-shrink-0">
                  {sessionName && (
                    <>
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
                    </>
                  )}
                  <button
                    onClick={() => deleteFile(file.name)}
                    className="p-1.5 text-text-tertiary hover:text-red-400 hover:bg-control-bg rounded"
                    title="Delete file"
                  >
                    ×
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}
