import { useState, useRef, useEffect, useCallback } from 'react'
import { filterPromptsByQuery, findMentionEndingAt } from '../utils/promptResolver'
import type { PromptTemplate } from '../utils/promptResolver'
import PromptDropdown from './PromptDropdown'

interface PromptMentionInputProps {
  value: string
  onChange: (value: string) => void
  prompts: PromptTemplate[]
  placeholder?: string
  className?: string
  multiline?: boolean
  rows?: number
  autoFocus?: boolean
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
}

export default function PromptMentionInput({
  value,
  onChange,
  prompts,
  placeholder,
  className = '',
  multiline = false,
  rows = 3,
  autoFocus = false,
  onBlur,
  onKeyDown,
}: PromptMentionInputProps) {
  const [isOpen, setIsOpen] = useState(false)
  const [triggerIndex, setTriggerIndex] = useState<number | null>(null)
  const [query, setQuery] = useState('')
  const [highlightedIndex, setHighlightedIndex] = useState(0)
  const [dropdownPosition, setDropdownPosition] = useState({ top: 0, left: 0 })

  const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null)
  const containerRef = useRef<HTMLDivElement>(null)

  const filteredPrompts = filterPromptsByQuery(prompts, query)

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false)
        setTriggerIndex(null)
      }
    }

    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [])

  // Reset highlighted index when filtered prompts change
  useEffect(() => {
    setHighlightedIndex(0)
  }, [query])

  const updateDropdownPosition = useCallback(() => {
    if (!inputRef.current) return

    const rect = inputRef.current.getBoundingClientRect()
    // Position below the input
    setDropdownPosition({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
    })
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const cursorPos = e.target.selectionStart || 0
    onChange(newValue)

    // Check if we just typed @ or are continuing after @
    if (triggerIndex !== null) {
      // Check if cursor is still after trigger
      if (cursorPos <= triggerIndex) {
        // Cursor moved before trigger, close dropdown
        setIsOpen(false)
        setTriggerIndex(null)
        setQuery('')
      } else {
        // Extract query text between @ and cursor
        const queryText = newValue.slice(triggerIndex + 1, cursorPos)
        // Close if there's whitespace in query
        if (/\s/.test(queryText)) {
          setIsOpen(false)
          setTriggerIndex(null)
          setQuery('')
        } else {
          setQuery(queryText)
          updateDropdownPosition()
        }
      }
    } else {
      // Check if we just typed @
      const charBeforeCursor = newValue[cursorPos - 1]
      if (charBeforeCursor === '@') {
        // Check if @ is at start or preceded by whitespace
        const charBeforeAt = newValue[cursorPos - 2]
        if (cursorPos === 1 || /\s/.test(charBeforeAt)) {
          setIsOpen(true)
          setTriggerIndex(cursorPos - 1)
          setQuery('')
          setHighlightedIndex(0)
          updateDropdownPosition()
        }
      }
    }
  }

  const handleSelect = (prompt: PromptTemplate) => {
    if (triggerIndex === null) return

    const cursorPos = inputRef.current?.selectionStart || value.length
    // Replace @query with @promptName
    const before = value.slice(0, triggerIndex)
    const after = value.slice(cursorPos)
    const newValue = `${before}@${prompt.name}${after}`

    onChange(newValue)
    setIsOpen(false)
    setTriggerIndex(null)
    setQuery('')

    // Focus and set cursor after inserted mention
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        const newCursorPos = triggerIndex + prompt.name.length + 1
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (isOpen && filteredPrompts.length > 0) {
      switch (e.key) {
        case 'ArrowDown':
          e.preventDefault()
          setHighlightedIndex((i) => Math.min(i + 1, filteredPrompts.length - 1))
          return
        case 'ArrowUp':
          e.preventDefault()
          setHighlightedIndex((i) => Math.max(i - 1, 0))
          return
        case 'Enter':
        case 'Tab':
          e.preventDefault()
          if (filteredPrompts[highlightedIndex]) {
            handleSelect(filteredPrompts[highlightedIndex])
          }
          return
        case 'Escape':
          e.preventDefault()
          setIsOpen(false)
          setTriggerIndex(null)
          setQuery('')
          return
      }
    }

    // Handle backspace to delete whole mention
    if (e.key === 'Backspace' && !isOpen) {
      const cursorPos = inputRef.current?.selectionStart || 0
      const selectionEnd = inputRef.current?.selectionEnd || 0

      // Only handle if no text is selected (cursor is a point)
      if (cursorPos === selectionEnd && cursorPos > 0) {
        const mention = findMentionEndingAt(value, cursorPos)
        if (mention) {
          e.preventDefault()
          const newValue = value.slice(0, mention.start) + value.slice(mention.end)
          onChange(newValue)

          // Set cursor to where mention started
          setTimeout(() => {
            if (inputRef.current) {
              inputRef.current.setSelectionRange(mention.start, mention.start)
            }
          }, 0)
          return
        }
      }
    }

    // Pass through to parent handler
    onKeyDown?.(e)
  }

  const handleBlur = () => {
    // Delay to allow click on dropdown item
    setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        setIsOpen(false)
        setTriggerIndex(null)
        onBlur?.()
      }
    }, 150)
  }

  const commonProps = {
    ref: inputRef as React.RefObject<HTMLInputElement> & React.RefObject<HTMLTextAreaElement>,
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onBlur: handleBlur,
    placeholder,
    autoFocus,
    className,
  }

  return (
    <div ref={containerRef} className="relative">
      {multiline ? (
        <textarea {...commonProps} rows={rows} />
      ) : (
        <input {...commonProps} type="text" />
      )}

      {isOpen && (
        <PromptDropdown
          prompts={filteredPrompts}
          highlightedIndex={highlightedIndex}
          onSelect={handleSelect}
          onHighlight={setHighlightedIndex}
          position={dropdownPosition}
        />
      )}
    </div>
  )
}
