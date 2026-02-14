import { useState, useEffect, useCallback } from 'react'
import '@git-diff-view/react/styles/diff-view.css'
import { FileList, FileDiff } from './diff'
import type { DiffData } from './diff'

interface Props {
  apiHost: string
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
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to fetch diff')
    } finally {
      setLoading(false)
    }
  }, [apiHost])

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

  // Single file diff view
  if (selectedFile) {
    const file = data.files.find(f => f.path === selectedFile)
    if (file) {
      return <FileDiff file={file} onBack={() => setSelectedFile(null)} />
    }
    setSelectedFile(null)
  }

  // File list view
  return (
    <FileList
      data={data}
      onSelectFile={setSelectedFile}
      onRefresh={fetchDiff}
    />
  )
}
