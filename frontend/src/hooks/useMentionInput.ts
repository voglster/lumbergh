import { useState, useRef, useEffect, useCallback } from 'react'
import { filterPromptsByQuery, findMentionEndingAt } from '../utils/promptResolver'
import type { PromptTemplate } from '../utils/promptResolver'

export function useMentionInput({
  value,
  onChange,
  prompts,
  onBlur,
  onKeyDown,
}: {
  value: string
  onChange: (value: string) => void
  prompts: PromptTemplate[]
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
}) {
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

  const resetAndSetQuery = useCallback((q: string) => {
    setQuery(q)
    setHighlightedIndex(0)
  }, [])

  const updateDropdownPosition = useCallback(() => {
    if (!inputRef.current) return

    const rect = inputRef.current.getBoundingClientRect()
    setDropdownPosition({
      top: rect.bottom + window.scrollY + 4,
      left: rect.left + window.scrollX,
    })
  }, [])

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    const newValue = e.target.value
    const cursorPos = e.target.selectionStart || 0
    onChange(newValue)

    if (triggerIndex !== null) {
      if (cursorPos <= triggerIndex) {
        setIsOpen(false)
        setTriggerIndex(null)
        resetAndSetQuery('')
      } else {
        const queryText = newValue.slice(triggerIndex + 1, cursorPos)
        if (/\s/.test(queryText)) {
          setIsOpen(false)
          setTriggerIndex(null)
          resetAndSetQuery('')
        } else {
          resetAndSetQuery(queryText)
          updateDropdownPosition()
        }
      }
    } else {
      const charBeforeCursor = newValue[cursorPos - 1]
      if (charBeforeCursor === '@') {
        const charBeforeAt = newValue[cursorPos - 2]
        if (cursorPos === 1 || /\s/.test(charBeforeAt)) {
          setIsOpen(true)
          setTriggerIndex(cursorPos - 1)
          resetAndSetQuery('')
          setHighlightedIndex(0)
          updateDropdownPosition()
        }
      }
    }
  }

  const handleSelect = (prompt: PromptTemplate) => {
    if (triggerIndex === null) return

    const cursorPos = inputRef.current?.selectionStart || value.length
    const before = value.slice(0, triggerIndex)
    const after = value.slice(cursorPos)
    const newValue = `${before}@${prompt.name}${after}`

    onChange(newValue)
    setIsOpen(false)
    setTriggerIndex(null)
    resetAndSetQuery('')

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.focus()
        const newCursorPos = triggerIndex + prompt.name.length + 1
        inputRef.current.setSelectionRange(newCursorPos, newCursorPos)
      }
    }, 0)
  }

  const handleDropdownNav = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
    if (!isOpen || filteredPrompts.length === 0) return false
    switch (e.key) {
      case 'ArrowDown':
        e.preventDefault()
        setHighlightedIndex((i) => Math.min(i + 1, filteredPrompts.length - 1))
        return true
      case 'ArrowUp':
        e.preventDefault()
        setHighlightedIndex((i) => Math.max(i - 1, 0))
        return true
      case 'Enter':
      case 'Tab':
        e.preventDefault()
        if (filteredPrompts[highlightedIndex]) {
          handleSelect(filteredPrompts[highlightedIndex])
        }
        return true
      case 'Escape':
        e.preventDefault()
        setIsOpen(false)
        setTriggerIndex(null)
        resetAndSetQuery('')
        return true
      default:
        return false
    }
  }

  const handleMentionBackspace = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): boolean => {
    if (e.key !== 'Backspace' || isOpen) return false
    const cursorPos = inputRef.current?.selectionStart || 0
    const selectionEnd = inputRef.current?.selectionEnd || 0

    if (cursorPos !== selectionEnd || cursorPos === 0) return false
    const mention = findMentionEndingAt(value, cursorPos)
    if (!mention) return false

    e.preventDefault()
    const newValue = value.slice(0, mention.start) + value.slice(mention.end)
    onChange(newValue)

    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.setSelectionRange(mention.start, mention.start)
      }
    }, 0)
    return true
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>) => {
    if (handleDropdownNav(e)) return
    if (handleMentionBackspace(e)) return
    onKeyDown?.(e)
  }

  const handleBlur = () => {
    setTimeout(() => {
      if (!containerRef.current?.contains(document.activeElement)) {
        setIsOpen(false)
        setTriggerIndex(null)
        onBlur?.()
      }
    }, 150)
  }

  return {
    isOpen,
    filteredPrompts,
    highlightedIndex,
    dropdownPosition,
    inputRef,
    containerRef,
    handleChange,
    handleKeyDown,
    handleBlur,
    handleSelect,
    setHighlightedIndex,
  }
}
