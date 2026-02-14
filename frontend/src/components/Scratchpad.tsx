import { useState, useEffect, useRef, useCallback } from 'react'

interface ScratchpadProps {
  apiHost: string
  sessionName: string
}

export default function Scratchpad({ apiHost, sessionName }: ScratchpadProps) {
  const [content, setContent] = useState('')
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [loading, setLoading] = useState(true)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  // Fetch content on mount
  useEffect(() => {
    fetch(`http://${apiHost}/api/sessions/${sessionName}/scratchpad`)
      .then(res => res.json())
      .then(data => {
        setContent(data.content || '')
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to fetch scratchpad:', err)
        setLoading(false)
      })
  }, [apiHost, sessionName])

  const saveContent = useCallback(async (text: string) => {
    setStatus('saving')
    try {
      await fetch(`http://${apiHost}/api/sessions/${sessionName}/scratchpad`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content: text }),
      })
      setStatus('saved')
      // Clear "Saved" indicator after 2 seconds
      setTimeout(() => setStatus('idle'), 2000)
    } catch (err) {
      console.error('Failed to save scratchpad:', err)
      setStatus('error')
    }
  }, [apiHost, sessionName])

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newContent = e.target.value
    setContent(newContent)
    setStatus('idle')

    // Clear existing timeout
    if (saveTimeoutRef.current) {
      clearTimeout(saveTimeoutRef.current)
    }

    // Debounce save: 500ms after typing stops
    saveTimeoutRef.current = setTimeout(() => {
      saveContent(newContent)
    }, 500)
  }

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  if (loading) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        Loading...
      </div>
    )
  }

  return (
    <div className="h-full p-2 relative">
      <span className={`absolute top-3 right-3 text-xs ${
        status === 'saving' ? 'text-yellow-400' :
        status === 'saved' ? 'text-green-400' :
        status === 'error' ? 'text-red-400' :
        'text-transparent'
      }`}>
        {status === 'saving' && 'Saving...'}
        {status === 'saved' && 'Saved'}
        {status === 'error' && 'Error saving'}
      </span>
      <textarea
        value={content}
        onChange={handleChange}
        placeholder="Type your notes here..."
        className="h-full w-full bg-gray-800 text-gray-100 border border-gray-700 rounded p-3 resize-none focus:outline-none focus:border-gray-500 font-mono text-sm"
      />
    </div>
  )
}
