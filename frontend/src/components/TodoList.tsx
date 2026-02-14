import { useState, useEffect, useRef } from 'react'

interface Todo {
  text: string
  done: boolean
}

interface TodoListProps {
  apiHost: string
}

export default function TodoList({ apiHost }: TodoListProps) {
  const [todos, setTodos] = useState<Todo[]>([])
  const [newTodo, setNewTodo] = useState('')
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [editingIndex, setEditingIndex] = useState<number | null>(null)
  const [editingText, setEditingText] = useState('')

  useEffect(() => {
    fetch(`http://${apiHost}/api/todos`)
      .then(res => res.json())
      .then(data => {
        setTodos(data.todos || [])
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to fetch todos:', err)
        setLoading(false)
      })
  }, [apiHost])

  const saveTodos = async (updatedTodos: Todo[]) => {
    setSaving(true)
    try {
      await fetch(`http://${apiHost}/api/todos`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ todos: updatedTodos }),
      })
    } catch (err) {
      console.error('Failed to save todos:', err)
    }
    setSaving(false)
  }

  const handleToggle = (index: number) => {
    const updated = todos.map((t, i) =>
      i === index ? { ...t, done: !t.done } : t
    )
    setTodos(updated)
    saveTodos(updated)
  }

  const handleAdd = () => {
    if (!newTodo.trim()) return
    const updated = [...todos, { text: newTodo.trim(), done: false }]
    setTodos(updated)
    setNewTodo('')
    saveTodos(updated)
  }

  const handleDelete = (index: number) => {
    const updated = todos.filter((_, i) => i !== index)
    setTodos(updated)
    saveTodos(updated)
  }

  const handleDeleteAllDone = () => {
    const updated = todos.filter(t => !t.done)
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
      const updated = todos.map((t, i) =>
        i === editingIndex ? { ...t, text: trimmed } : t
      )
      setTodos(updated)
      saveTodos(updated)
    }
    setEditingIndex(null)
    setEditingText('')
  }

  const handleEditKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') {
      handleSaveEdit()
    } else if (e.key === 'Escape') {
      setEditingIndex(null)
      setEditingText('')
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
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Loading...
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      {/* Add todo input */}
      <div className="flex gap-2 mb-4">
        <input
          type="text"
          value={newTodo}
          onChange={e => setNewTodo(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Add a task..."
          className="flex-1 px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500"
        />
        <button
          onClick={handleAdd}
          disabled={!newTodo.trim()}
          className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          Add
        </button>
        {todos.some(t => t.done) && (
          <button
            onClick={handleDeleteAllDone}
            className="px-3 py-2 text-gray-400 hover:text-red-400 text-sm"
            title="Delete completed tasks"
          >
            Clear done
          </button>
        )}
      </div>

      {/* Todo list */}
      <div className="flex-1 overflow-y-auto">
        {todos.length === 0 ? (
          <div className="text-gray-500 text-center py-8">
            No tasks yet. Add one above!
          </div>
        ) : (
          <ul className="space-y-2">
            {todos.map((todo, index) => (
              <li
                key={index}
                draggable
                onDragStart={() => handleDragStart(index)}
                onDragOver={(e) => handleDragOver(e, index)}
                onDragEnd={handleDragEnd}
                className={`flex items-center gap-3 p-3 bg-gray-800 rounded border border-gray-700 group cursor-grab active:cursor-grabbing ${
                  dragIndex === index ? 'opacity-50' : ''
                } ${dragOverIndex === index && dragIndex !== index ? 'border-blue-500' : ''}`}
              >
                <span className="text-gray-600 select-none">⠿</span>
                <input
                  type="checkbox"
                  checked={todo.done}
                  onChange={() => handleToggle(index)}
                  className="w-5 h-5 rounded bg-gray-700 border-gray-600 text-blue-500 focus:ring-blue-500 focus:ring-offset-gray-900"
                />
                {editingIndex === index ? (
                  <input
                    type="text"
                    value={editingText}
                    onChange={e => setEditingText(e.target.value)}
                    onBlur={handleSaveEdit}
                    onKeyDown={handleEditKeyDown}
                    autoFocus
                    className="flex-1 px-2 py-1 bg-gray-700 text-white rounded border border-blue-500 focus:outline-none"
                  />
                ) : (
                  <span
                    onClick={() => handleStartEdit(index)}
                    className={`flex-1 cursor-text ${
                      todo.done ? 'text-gray-500 line-through' : 'text-white'
                    }`}
                  >
                    {todo.text}
                  </span>
                )}
                <button
                  onClick={() => handleDelete(index)}
                  className="text-gray-500 hover:text-red-400 opacity-0 group-hover:opacity-100 transition-opacity"
                  title="Delete"
                >
                  ✕
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Saving indicator */}
      {saving && (
        <div className="text-gray-500 text-sm text-center py-2">
          Saving...
        </div>
      )}
    </div>
  )
}
