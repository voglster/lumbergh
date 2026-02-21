import { useState, useEffect, useRef, useCallback } from 'react'
import { useLocalStorageDraft } from '../hooks/useLocalStorageDraft'

interface ScratchpadProps {
  apiHost: string
  sessionName: string
  onFocusTerminal?: () => void
}

export default function Scratchpad({ apiHost, sessionName, onFocusTerminal }: ScratchpadProps) {
  const [content, setContent] = useLocalStorageDraft(`scratchpad:${sessionName}`, '', 100)
  const [status, setStatus] = useState<'idle' | 'saving' | 'saved' | 'error'>('idle')
  const [loading, setLoading] = useState(true)
  const [hasSelection, setHasSelection] = useState(false)
  const saveTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const selectedTextRef = useRef('')
  const contentRef = useRef(content)
  contentRef.current = content

  // Fetch content on mount - localStorage draft takes priority over backend
  useEffect(() => {
    fetch(`http://${apiHost}/api/sessions/${sessionName}/scratchpad`)
      .then((res) => res.json())
      .then((data) => {
        // Only use backend content if we don't have a localStorage draft
        if (!contentRef.current) {
          setContent(data.content || '')
        }
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch scratchpad:', err)
        setLoading(false)
      })
  }, [apiHost, sessionName])

  const saveContent = useCallback(
    async (text: string) => {
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
    },
    [apiHost, sessionName]
  )

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

  const handleSelect = () => {
    const textarea = textareaRef.current
    if (textarea) {
      const selected = textarea.value.substring(textarea.selectionStart, textarea.selectionEnd)
      selectedTextRef.current = selected
      setHasSelection(selected.length > 0)
    }
  }

  const handleSendToTerminal = async () => {
    const text = selectedTextRef.current
    if (!text) return

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

  // Cleanup timeout on unmount
  useEffect(() => {
    return () => {
      if (saveTimeoutRef.current) {
        clearTimeout(saveTimeoutRef.current)
      }
    }
  }, [])

  if (loading) {
    return <div className="h-full flex items-center justify-center text-text-muted">Loading...</div>
  }

  return (
    <div className="h-full p-2 relative">
      {hasSelection && (
        <button
          onMouseDown={(e) => {
            e.preventDefault() // Prevent blur from firing
            handleSendToTerminal()
          }}
          className="absolute top-3 right-20 px-2 py-1 text-xs bg-blue-600 hover:bg-blue-500 rounded"
          title="Send selected text to terminal (no Enter)"
        >
          Send to Terminal
        </button>
      )}
      <span
        className={`absolute top-3 right-3 text-xs ${
          status === 'saving'
            ? 'text-yellow-400'
            : status === 'saved'
              ? 'text-green-400'
              : status === 'error'
                ? 'text-red-400'
                : 'text-transparent'
        }`}
      >
        {status === 'saving' && 'Saving...'}
        {status === 'saved' && 'Saved'}
        {status === 'error' && 'Error saving'}
      </span>
      <textarea
        ref={textareaRef}
        value={content}
        onChange={handleChange}
        onSelect={handleSelect}
        onBlur={() => setHasSelection(false)}
        placeholder="Type your notes here..."
        className="h-full w-full bg-bg-surface text-text-secondary border border-border-default rounded p-3 resize-none focus:outline-none focus:border-border-subtle font-mono text-sm"
      />
    </div>
  )
}
