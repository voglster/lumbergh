import { useState, useEffect } from 'react'

// Simple UUID generator that works without crypto.randomUUID()
function generateId(): string {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0
    const v = c === 'x' ? r : (r & 0x3) | 0x8
    return v.toString(16)
  })
}

interface PromptTemplate {
  id: string
  name: string
  prompt: string
}

interface PromptTemplatesProps {
  apiHost: string
  sessionName?: string | null
  onFocusTerminal?: () => void
}

export default function PromptTemplates({ apiHost, sessionName, onFocusTerminal }: PromptTemplatesProps) {
  const [projectTemplates, setProjectTemplates] = useState<PromptTemplate[]>([])
  const [globalTemplates, setGlobalTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(true)
  const [saving, setSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null)
  const [showForm, setShowForm] = useState<'project' | 'global' | null>(null)
  const [formName, setFormName] = useState('')
  const [formPrompt, setFormPrompt] = useState('')
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [dragScope, setDragScope] = useState<'project' | 'global' | null>(null)

  useEffect(() => {
    Promise.all([
      fetch(`http://${apiHost}/api/prompts`).then(res => res.json()),
      fetch(`http://${apiHost}/api/global/prompts`).then(res => res.json()),
    ])
      .then(([projectData, globalData]) => {
        setProjectTemplates(projectData.templates || [])
        setGlobalTemplates(globalData.templates || [])
        setLoading(false)
      })
      .catch(err => {
        console.error('Failed to fetch prompts:', err)
        setLoading(false)
      })
  }, [apiHost])

  const saveProjectTemplates = async (templates: PromptTemplate[]) => {
    setSaving(true)
    try {
      await fetch(`http://${apiHost}/api/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates }),
      })
    } catch (err) {
      console.error('Failed to save project prompts:', err)
    }
    setSaving(false)
  }

  const saveGlobalTemplates = async (templates: PromptTemplate[]) => {
    setSaving(true)
    try {
      await fetch(`http://${apiHost}/api/global/prompts`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ templates }),
      })
    } catch (err) {
      console.error('Failed to save global prompts:', err)
    }
    setSaving(false)
  }

  const handleSendToTerminal = async (template: PromptTemplate, sendEnter: boolean) => {
    if (!sessionName) return
    try {
      await fetch(`http://${apiHost}/api/session/${sessionName}/send`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text: template.prompt, send_enter: sendEnter }),
      })
      onFocusTerminal?.()
    } catch (err) {
      console.error('Failed to send to terminal:', err)
    }
  }

  const handleSaveTemplate = () => {
    if (!formName.trim() || !formPrompt.trim() || !showForm) return

    const newTemplate: PromptTemplate = {
      id: editingTemplate?.id || generateId(),
      name: formName.trim(),
      prompt: formPrompt.trim(),
    }

    if (showForm === 'project') {
      const updated = editingTemplate
        ? projectTemplates.map(t => t.id === editingTemplate.id ? newTemplate : t)
        : [...projectTemplates, newTemplate]
      setProjectTemplates(updated)
      saveProjectTemplates(updated)
    } else {
      const updated = editingTemplate
        ? globalTemplates.map(t => t.id === editingTemplate.id ? newTemplate : t)
        : [...globalTemplates, newTemplate]
      setGlobalTemplates(updated)
      saveGlobalTemplates(updated)
    }

    // Reset form
    setFormName('')
    setFormPrompt('')
    setEditingTemplate(null)
    setShowForm(null)
  }

  const handleEdit = (template: PromptTemplate, scope: 'project' | 'global') => {
    setEditingTemplate(template)
    setFormName(template.name)
    setFormPrompt(template.prompt)
    setShowForm(scope)
  }

  const handleCancelEdit = () => {
    setEditingTemplate(null)
    setFormName('')
    setFormPrompt('')
    setShowForm(null)
  }

  const handleStartAdd = (scope: 'project' | 'global') => {
    setEditingTemplate(null)
    setFormName('')
    setFormPrompt('')
    setShowForm(scope)
  }

  const handleDelete = (id: string, scope: 'project' | 'global') => {
    if (scope === 'project') {
      const updated = projectTemplates.filter(t => t.id !== id)
      setProjectTemplates(updated)
      saveProjectTemplates(updated)
    } else {
      const updated = globalTemplates.filter(t => t.id !== id)
      setGlobalTemplates(updated)
      saveGlobalTemplates(updated)
    }
    if (editingTemplate?.id === id) {
      handleCancelEdit()
    }
  }

  const handleCopyToGlobal = async (template: PromptTemplate) => {
    try {
      await fetch(`http://${apiHost}/api/prompts/${template.id}/copy-to-global`, {
        method: 'POST',
      })
      // Refresh both lists
      const [projectData, globalData] = await Promise.all([
        fetch(`http://${apiHost}/api/prompts`).then(res => res.json()),
        fetch(`http://${apiHost}/api/global/prompts`).then(res => res.json()),
      ])
      setProjectTemplates(projectData.templates || [])
      setGlobalTemplates(globalData.templates || [])
    } catch (err) {
      console.error('Failed to copy to global:', err)
    }
  }

  const handleCopyToProject = async (template: PromptTemplate) => {
    try {
      await fetch(`http://${apiHost}/api/global/prompts/${template.id}/copy-to-project`, {
        method: 'POST',
      })
      // Refresh project list
      const projectData = await fetch(`http://${apiHost}/api/prompts`).then(res => res.json())
      setProjectTemplates(projectData.templates || [])
    } catch (err) {
      console.error('Failed to copy to project:', err)
    }
  }

  // Drag and drop handlers
  const handleDragStart = (index: number, scope: 'project' | 'global') => {
    setDragIndex(index)
    setDragScope(scope)
  }

  const handleDragOver = (e: React.DragEvent, index: number, scope: 'project' | 'global') => {
    e.preventDefault()
    // Only allow drag within same scope
    if (scope === dragScope) {
      setDragOverIndex(index)
    }
  }

  const handleDragEnd = () => {
    if (dragIndex !== null && dragOverIndex !== null && dragIndex !== dragOverIndex && dragScope) {
      if (dragScope === 'project') {
        const updated = [...projectTemplates]
        const [dragged] = updated.splice(dragIndex, 1)
        updated.splice(dragOverIndex, 0, dragged)
        setProjectTemplates(updated)
        saveProjectTemplates(updated)
      } else {
        const updated = [...globalTemplates]
        const [dragged] = updated.splice(dragIndex, 1)
        updated.splice(dragOverIndex, 0, dragged)
        setGlobalTemplates(updated)
        saveGlobalTemplates(updated)
      }
    }
    setDragIndex(null)
    setDragOverIndex(null)
    setDragScope(null)
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-500">
        Loading...
      </div>
    )
  }

  const renderTemplateItem = (template: PromptTemplate, index: number, scope: 'project' | 'global') => {
    const isDragging = dragScope === scope && dragIndex === index
    const isDragOver = dragScope === scope && dragOverIndex === index && dragIndex !== index

    return (
      <div
        key={template.id}
        draggable={editMode}
        onDragStart={() => handleDragStart(index, scope)}
        onDragOver={(e) => handleDragOver(e, index, scope)}
        onDragEnd={handleDragEnd}
        className={`flex items-center gap-2 p-3 bg-gray-800 rounded border border-gray-700 group ${
          editMode ? 'cursor-grab active:cursor-grabbing' : ''
        } ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'border-blue-500' : ''}`}
      >
        {editMode && <span className="text-gray-600 select-none">&#x2807;</span>}
        <span className="flex-1 text-white truncate" title={template.prompt}>
          {template.name}
        </span>
        {!editMode && sessionName && (
          <>
            <button
              onClick={() => handleSendToTerminal(template, false)}
              className="text-xl text-gray-500 hover:text-yellow-400 transition-colors px-1"
              title="Send text (no Enter)"
            >
              &#x25B7;
            </button>
            <button
              onClick={() => handleSendToTerminal(template, true)}
              className="text-xl text-gray-500 hover:text-blue-400 transition-colors px-1"
              title="Send + Enter (yolo)"
            >
              &#x27A4;
            </button>
          </>
        )}
        {editMode && (
          <>
            <button
              onClick={() => handleEdit(template, scope)}
              className="text-sm text-gray-500 hover:text-blue-400 transition-colors px-1"
              title="Edit"
            >
              Edit
            </button>
            {scope === 'project' ? (
              <button
                onClick={() => handleCopyToGlobal(template)}
                className="text-sm text-gray-500 hover:text-green-400 transition-colors px-1"
                title="Move to Global"
              >
                &#x2191;G
              </button>
            ) : (
              <button
                onClick={() => handleCopyToProject(template)}
                className="text-sm text-gray-500 hover:text-green-400 transition-colors px-1"
                title="Copy to Project"
              >
                &#x2193;P
              </button>
            )}
            <button
              onClick={() => handleDelete(template.id, scope)}
              className="text-sm text-gray-500 hover:text-red-400 transition-colors px-1"
              title="Delete"
            >
              &#x00D7;
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-200">Prompt Templates</h2>
        <button
          onClick={() => {
            if (editMode) handleCancelEdit()
            setEditMode(!editMode)
          }}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            editMode
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-gray-700 text-gray-400 hover:bg-gray-600 hover:text-gray-200'
          }`}
        >
          {editMode ? 'Done' : 'Edit'}
        </button>
      </div>

      {/* Template lists */}
      <div className="flex-1 overflow-y-auto space-y-4">
        {/* Project templates */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-400">Project Templates</h3>
            {editMode && showForm !== 'project' && (
              <button
                type="button"
                onClick={() => handleStartAdd('project')}
                className="text-xs px-2 py-1 bg-gray-700 text-gray-400 rounded hover:bg-gray-600 hover:text-gray-200 transition-colors"
              >
                + Add
              </button>
            )}
          </div>
          {showForm === 'project' && (
            <div className="mb-2 p-3 bg-gray-800 rounded border border-blue-500">
              <div className="mb-2">
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Template name"
                  autoFocus
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="mb-2">
                <textarea
                  value={formPrompt}
                  onChange={e => setFormPrompt(e.target.value)}
                  placeholder="Prompt text..."
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={!formName.trim() || !formPrompt.trim()}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {editingTemplate ? 'Update' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 bg-gray-700 text-gray-400 text-sm rounded hover:bg-gray-600 hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {projectTemplates.length === 0 && showForm !== 'project' ? (
            <div className="text-gray-500 text-sm py-2">
              No project templates yet.
            </div>
          ) : (
            <div className="space-y-2">
              {projectTemplates.map((template, index) =>
                renderTemplateItem(template, index, 'project')
              )}
            </div>
          )}
        </div>

        {/* Global templates */}
        <div>
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-medium text-gray-400">Global Templates</h3>
            {editMode && showForm !== 'global' && (
              <button
                type="button"
                onClick={() => handleStartAdd('global')}
                className="text-xs px-2 py-1 bg-gray-700 text-gray-400 rounded hover:bg-gray-600 hover:text-gray-200 transition-colors"
              >
                + Add
              </button>
            )}
          </div>
          {showForm === 'global' && (
            <div className="mb-2 p-3 bg-gray-800 rounded border border-blue-500">
              <div className="mb-2">
                <input
                  type="text"
                  value={formName}
                  onChange={e => setFormName(e.target.value)}
                  placeholder="Template name"
                  autoFocus
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500"
                />
              </div>
              <div className="mb-2">
                <textarea
                  value={formPrompt}
                  onChange={e => setFormPrompt(e.target.value)}
                  placeholder="Prompt text..."
                  rows={3}
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 resize-none"
                />
              </div>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleSaveTemplate}
                  disabled={!formName.trim() || !formPrompt.trim()}
                  className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                  {editingTemplate ? 'Update' : 'Add'}
                </button>
                <button
                  type="button"
                  onClick={handleCancelEdit}
                  className="px-3 py-1.5 bg-gray-700 text-gray-400 text-sm rounded hover:bg-gray-600 hover:text-gray-200 transition-colors"
                >
                  Cancel
                </button>
              </div>
            </div>
          )}
          {globalTemplates.length === 0 && showForm !== 'global' ? (
            <div className="text-gray-500 text-sm py-2">
              No global templates yet.
            </div>
          ) : (
            <div className="space-y-2">
              {globalTemplates.map((template, index) =>
                renderTemplateItem(template, index, 'global')
              )}
            </div>
          )}
        </div>
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
