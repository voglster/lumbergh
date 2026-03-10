import { useState, useEffect, useRef, useCallback } from 'react'
import {
  GripVertical,
  Play,
  SendHorizonal,
  ChevronDown,
  ChevronRight,
  StickyNote,
  ExternalLink,
  Trash2,
} from 'lucide-react'
import { getApiBase } from '../config'
import { usePrompts } from '../hooks/usePrompts'
import { useLocalStorageDraft } from '../hooks/useLocalStorageDraft'
import { expandPromptReferences } from '../utils/promptResolver'
import PromptMentionInput from './PromptMentionInput'
import MentionText from './MentionText'

interface Todo {
  text: string
  done: boolean
  description?: string
}

interface TodoListProps {
  sessionName: string
  onFocusTerminal?: () => void
  onTodoSent?: (text: string) => void
  onSwitchToTerminal?: () => void
}

export default function TodoList({
  sessionName,
  onFocusTerminal,
  onTodoSent,
  onSwitchToTerminal,
}: TodoListProps) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [newTodo, setNewTodo, clearNewTodoDraft] = useLocalStorageDraft(`todo:${sessionName}:new`)
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')
  const [expandedIndex, setExpandedIndex] = useState<number | null>(null)
  const [editingDescription, setEditingDescription] = useState('')
  const [movePickerIndex, setMovePickerIndex] = useState<number | null>(null)
  const [availableSessions, setAvailableSessions] = useState<
    { name: string; displayName?: string }[]
  >([])
  const [highlightIndex, setHighlightIndex] = useState<number | null>(null)
  const movePickerRef = useRef<HTMLDivElement>(null)
  const highlightTimerRef = useRef<ReturnType<typeof setTimeout>>(null)
  const descriptionSaveTimerRef = useRef<ReturnType<typeof setTimeout>>(null)

  // Fetch prompts for @ mention autocomplete
  const { allPrompts } = usePrompts(sessionName)

  useEffect(() => {
    fetch(`${getApiBase()}/sessions/${sessionName}/todos`)
      .then((res) => res.json())
      .then((data) => {
        setTodos(data.todos || [])
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch todos:', err)
        setLoading(false)
      })
  }, [sessionName])

  const saveTodos = useCallback(
    async (updatedTodos: Todo[]) => {
      setSaving(true)
      try {
        await fetch(`${getApiBase()}/sessions/${sessionName}/todos`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ todos: updatedTodos }),
        })
      } catch (err) {
        console.error('Failed to save todos:', err)
      }
      setSaving(false)
    },
    [sessionName]
  )

  const handleToggle = (index: number) => {
    const toggled = { ...todos[index], done: !todos[index].done }
    const rest = todos.filter((_, i) => i !== index)
    const unchecked = rest.filter((t) => !t.done)
    const checked = rest.filter((t) => t.done)
    // When unchecking, prepend to top; when checking, append to checked
    const reordered = toggled.done
      ? [...unchecked, toggled, ...checked]
      : [toggled, ...unchecked, ...checked]
    // Highlight the moved item's new position
    const newIndex = toggled.done ? unchecked.length : 0
    if (highlightTimerRef.current) clearTimeout(highlightTimerRef.current)
    setHighlightIndex(newIndex)
    highlightTimerRef.current = setTimeout(() => setHighlightIndex(null), 850)
    setTodos(reordered)
    saveTodos(reordered)
  }

  const handleAdd = () => {
    if (!newTodo.trim()) return
    const updated = [{ text: newTodo.trim(), done: false }, ...todos]
    setTodos(updated)
    clearNewTodoDraft()
    saveTodos(updated)
  }

  const handleDelete = (index: number) => {
    const updated = todos.filter((_, i) => i !== index)
    setTodos(updated)
    saveTodos(updated)
  }

  const handleDeleteAllDone = () => {
    const updated = todos.filter((t) => !t.done)
    setTodos(updated)
    saveTodos(updated)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleAdd()
    }
  }

  const handleStartEdit = (index: number) => {
    setEditingIndex(index)
    setEditingText(todos[index].text)
  }

  const handleSaveEdit = () => {
    if (editingIndex === null) return
    const trimmed = editingText.trim()
    if (trimmed && trimmed !== todos[editingIndex].text) {
      const updated = todos.map((t, i) => (i === editingIndex ? { ...t, text: trimmed } : t))
      setTodos(updated)
      saveTodos(updated)
    }
    setEditingIndex(null)
    setEditingText('')
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && e.shiftKey) {
      e.preventDefault()
      const idx = editingIndex!
      handleSaveEdit()
      setExpandedIndex(idx)
      setEditingDescription(todos[idx].description || '')
    } else if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setEditingIndex(null)
      setEditingText('')
    }
  }

  const handleToggleExpand = (index: number) => {
    if (expandedIndex === index) {
      // Collapsing - save any description changes
      handleSaveDescription(index)
      setExpandedIndex(null)
    } else {
      // Expanding - load the description
      setExpandedIndex(index)
      setEditingDescription(todos[index].description || '')
    }
  }

  const handleSaveDescription = useCallback(
    (index: number) => {
      const trimmed = editingDescription.trim()
      const currentDesc = todos[index].description || ''
      if (trimmed !== currentDesc) {
        const updated = todos.map((t, i) =>
          i === index ? { ...t, description: trimmed || undefined } : t
        )
        setTodos(updated)
        saveTodos(updated)
      }
    },
    [editingDescription, todos, saveTodos]
  )

  // Auto-save description on debounced change
  useEffect(() => {
    if (expandedIndex === null) return
    if (descriptionSaveTimerRef.current) clearTimeout(descriptionSaveTimerRef.current)
    descriptionSaveTimerRef.current = setTimeout(() => {
      handleSaveDescription(expandedIndex)
    }, 800)
    return () => {
      if (descriptionSaveTimerRef.current) clearTimeout(descriptionSaveTimerRef.current)
    }
  }, [editingDescription, expandedIndex, handleSaveDescription])

  const handleDescriptionKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      if (descriptionSaveTimerRef.current) clearTimeout(descriptionSaveTimerRef.current)
      setEditingDescription(todos[expandedIndex!]?.description || '')
      setExpandedIndex(null)
    }
  }

  // Close move picker on click outside
  useEffect(() => {
    if (movePickerIndex === null) return
    const handleClickOutside = (e: MouseEvent) => {
      if (movePickerRef.current && !movePickerRef.current.contains(e.target as Node)) {
        setMovePickerIndex(null)
      }
    }
    document.addEventListener('mousedown', handleClickOutside)
    return () => document.removeEventListener('mousedown', handleClickOutside)
  }, [movePickerIndex])

  const handleOpenMovePicker = async (index: number) => {
    if (movePickerIndex === index) {
      setMovePickerIndex(null)
      return
    }
    setMovePickerIndex(index)
    try {
      const res = await fetch(`${getApiBase()}/sessions`)
      const data = await res.json()
      const sessions = (data.sessions || []).filter(
        (s: { name: string; alive: boolean }) => s.name !== sessionName && s.alive
      )
      setAvailableSessions(sessions)
    } catch (err) {
      console.error('Failed to fetch sessions:', err)
    }
  }

  const handleMoveTodo = async (index: number, targetSession: string) => {
    try {
      const res = await fetch(`${getApiBase()}/sessions/${sessionName}/todos/move`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ target_session: targetSession, todo_index: index }),
      })
      const data = await res.json()
      setTodos(data.source_todos || [])
      setMovePickerIndex(null)
    } catch (err) {
      console.error('Failed to move todo:', err)
    }
  }

  const handleSendToTerminal = async (index: number, sendEnter: boolean = true) => {
    if (!sessionName) return
    const todo = todos[index]
    // Combine title and description if description exists
    const rawText = todo.description ? `${todo.text}\n\n${todo.description}` : todo.text
    // Expand @prompt references to their content
    const textToSend = expandPromptReferences(rawText, allPrompts)
    try {
      await fetch(`${getApiBase()}/session/${sessionName}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: textToSend, send_enter: sendEnter }),
      })
      // Mark as done and move to bottom (with other done items)
      const updated = todos.map((t, i) => (i === index ? { ...t, done: true } : t))
      const unchecked = updated.filter((t) => !t.done)
      const checked = updated.filter((t) => t.done)
      const reordered = [...unchecked, ...checked]
      setTodos(reordered)
      saveTodos(reordered)
      onFocusTerminal?.()
      onSwitchToTerminal?.()
      onTodoSent?.(textToSend)
    } catch (err) {
      console.error('Failed to send to terminal:', err)
    }
  }

  const handleDragStart = (index: number) => {
    setDragIndex(index)
  }

  const handleDragOver = (e: React.DragEvent, index: number) => {
    e.preventDefault()
    setDragOverIndex(index)
  }

  const handleDragEnd = () => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex) {
      const updated = [...todos]
      const [dragged] = updated.splice(dragIndex, 1)
      updated.splice(dragOverIndex, 0, dragged)
      setTodos(updated)
      saveTodos(updated)
    }
    setDragIndex(null)
    setDragOverIndex(null)
  }

  if (loading) {
    return <div className="flex items-center justify-center h-full text-text-muted">Loading...</div>
  }

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      {/* Add todo input */}
      <div className="mb-4">
        <PromptMentionInput
          value={newTodo}
          onChange={setNewTodo}
          prompts={allPrompts}
          onKeyDown={handleKeyDown}
          placeholder="Add a task... (press Enter, use @ to reference prompts)"
          className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500"
        />
      </div>

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto">
        {todos.length === 0 ? (
          <div className="text-text-muted text-center py-8">No tasks yet. Add one above!</div>
        ) : (
          <ul className="space-y-2">
            {todos.map((todo, index) => {
              const prevTodo = index > 0 ? todos[index - 1] : null
              const showCompletedSeparator = todo.done && (!prevTodo || !prevTodo.done)
              return (
                <li key={index}>
                  {showCompletedSeparator && (
                    <div className="flex items-center gap-2 py-2 mb-2">
                      <div className="flex-1 border-t border-border-default" />
                      <span className="text-xs text-text-muted uppercase tracking-wide">
                        Completed
                      </span>
                      <button
                        onClick={handleDeleteAllDone}
                        className="text-xs text-text-muted hover:text-red-400 transition-colors"
                        title="Clear completed tasks"
                      >
                        (clear)
                      </button>
                      <div className="flex-1 border-t border-border-default" />
                    </div>
                  )}
                  <div
                    className={`bg-bg-surface rounded border border-border-default ${
                      dragIndex === index ? 'opacity-50' : ''
                    } ${dragOverIndex === index && dragIndex !== index ? 'border-blue-500' : ''} ${
                      highlightIndex === index ? 'todo-highlight' : ''
                    }`}
                  >
                    <div
                      draggable
                      onDragStart={() => handleDragStart(index)}
                      onDragOver={(e) => handleDragOver(e, index)}
                      onDragEnd={handleDragEnd}
                      className="flex items-center gap-3 px-3 py-1 cursor-grab active:cursor-grabbing"
                    >
                      <GripVertical size={16} className="text-text-muted select-none" />
                      {sessionName && !todo.done && (
                        <>
                          <button
                            onClick={() => handleSendToTerminal(index, false)}
                            className="text-text-muted hover:text-yellow-400 transition-colors px-1"
                            title="Send text (no Enter)"
                          >
                            <Play size={18} />
                          </button>
                          <button
                            onClick={() => handleSendToTerminal(index, true)}
                            className="text-text-muted hover:text-blue-400 transition-colors px-1"
                            title="Send + Enter (yolo)"
                          >
                            <SendHorizonal size={18} />
                          </button>
                        </>
                      )}
                      <button
                        onClick={() => handleToggleExpand(index)}
                        className="w-8 h-8 flex items-center justify-center text-text-muted hover:text-text-secondary hover:bg-control-bg rounded transition-colors text-xl"
                        title={expandedIndex === index ? 'Collapse' : 'Expand'}
                      >
                        {expandedIndex === index ? (
                          <ChevronDown size={18} />
                        ) : (
                          <ChevronRight size={18} />
                        )}
                      </button>
                      {editingIndex === index ? (
                        <PromptMentionInput
                          value={editingText}
                          onChange={setEditingText}
                          prompts={allPrompts}
                          onBlur={handleSaveEdit}
                          onKeyDown={handleEditKeyDown}
                          autoFocus
                          containerClassName="flex-1 min-w-0"
                          className="w-full px-2 py-1 bg-input-bg text-text-primary text-base rounded border border-blue-500 focus:outline-none"
                        />
                      ) : (
                        <span
                          onClick={() => handleStartEdit(index)}
                          className={`flex-1 cursor-text ${
                            todo.done ? 'text-text-muted line-through' : 'text-text-primary'
                          }`}
                        >
                          {todo.done ? (
                            todo.text
                          ) : (
                            <MentionText text={todo.text} prompts={allPrompts} />
                          )}
                          {todo.description && expandedIndex !== index && (
                            <span className="ml-2 inline-flex" title="Has description">
                              <StickyNote size={14} className="text-text-muted" />
                            </span>
                          )}
                        </span>
                      )}
                      {sessionName && !todo.done && (
                        <button
                          onClick={() => handleOpenMovePicker(index)}
                          className={`text-sm text-text-muted hover:text-green-400 transition-colors px-1 ${movePickerIndex === index ? 'text-green-400' : ''}`}
                          title="Move to another session"
                        >
                          <ExternalLink size={16} />
                        </button>
                      )}
                      {todo.done && (
                        <button
                          onClick={() => handleDelete(index)}
                          className="text-sm text-red-400/50 hover:text-red-400 transition-colors px-1"
                          title="Delete task"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                      <input
                        type="checkbox"
                        checked={todo.done}
                        onChange={() => handleToggle(index)}
                        className="w-5 h-5 rounded bg-bg-surface border-input-border text-blue-500 focus:ring-blue-500 accent-blue-500"
                      />
                    </div>
                    {movePickerIndex === index && (
                      <div ref={movePickerRef} className="px-3 py-2 border-t border-border-default">
                        <div className="text-xs text-text-muted mb-1">Move to:</div>
                        {availableSessions.length === 0 ? (
                          <div className="text-xs text-text-muted">No other sessions available</div>
                        ) : (
                          <div className="flex flex-wrap gap-1">
                            {availableSessions.map((s) => (
                              <button
                                key={s.name}
                                onClick={() => handleMoveTodo(index, s.name)}
                                className="px-2 py-1 text-xs bg-control-bg hover:bg-blue-600 text-text-secondary hover:text-white rounded transition-colors"
                              >
                                {s.displayName || s.name}
                              </button>
                            ))}
                          </div>
                        )}
                      </div>
                    )}
                    {expandedIndex === index && (
                      <div className="px-3 pb-3 pt-0">
                        <PromptMentionInput
                          value={editingDescription}
                          onChange={setEditingDescription}
                          prompts={allPrompts}
                          onBlur={() => handleSaveDescription(index)}
                          onKeyDown={handleDescriptionKeyDown}
                          placeholder="Add details, context, acceptance criteria... (use @ to reference prompts)"
                          multiline
                          rows={5}
                          autoFocus
                          className="w-full h-32 px-3 py-2 bg-input-bg text-text-primary text-sm rounded border border-input-border focus:outline-none focus:border-blue-500 resize-y"
                        />
                      </div>
                    )}
                  </div>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      {/* Saving indicator */}
      {saving && <div className="text-text-muted text-sm text-center py-2">Saving...</div>}
    </div>
  )
}
