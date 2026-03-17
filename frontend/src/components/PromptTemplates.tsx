import { useState, useEffect } from 'react'
import { Play, GripVertical, X } from 'lucide-react'
import { getApiBase } from '../config'
import { useLocalStorageDraft } from '../hooks/useLocalStorageDraft'

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

function TemplateItem({
  template,
  index,
  scope,
  editMode,
  sessionName,
  isDragging,
  isDragOver,
  onDragStart,
  onDragOver,
  onDragEnd,
  onEdit,
  onSendToTerminal,
  onCopyToGlobal,
  onCopyToProject,
  onDelete,
}: {
  template: PromptTemplate
  index: number
  scope: 'project' | 'global'
  editMode: boolean
  sessionName?: string | null
  isDragging: boolean
  isDragOver: boolean
  onDragStart: (index: number, scope: 'project' | 'global') => void
  onDragOver: (e: React.DragEvent, index: number, scope: 'project' | 'global') => void
  onDragEnd: () => void
  onEdit: (template: PromptTemplate, scope: 'project' | 'global') => void
  onSendToTerminal: (template: PromptTemplate, sendEnter: boolean) => void
  onCopyToGlobal: (template: PromptTemplate) => void
  onCopyToProject: (template: PromptTemplate) => void
  onDelete: (id: string, scope: 'project' | 'global') => void
}) {
  return (
    <div
      draggable={editMode}
      onDragStart={() => onDragStart(index, scope)}
      onDragOver={(e) => onDragOver(e, index, scope)}
      onDragEnd={onDragEnd}
      onClick={editMode ? () => onEdit(template, scope) : undefined}
      className={`flex items-center gap-2 p-3 bg-bg-surface rounded border border-border-default group ${
        editMode ? 'cursor-pointer hover:border-blue-500/50' : ''
      } ${isDragging ? 'opacity-50' : ''} ${isDragOver ? 'border-blue-500' : ''}`}
    >
      {editMode && <GripVertical size={16} className="text-text-muted select-none" />}
      {!editMode && sessionName && (
        <button
          onClick={() => onSendToTerminal(template, false)}
          className="text-text-muted hover:text-yellow-400 transition-colors px-1"
          title="Send text (no Enter)"
        >
          <Play size={18} />
        </button>
      )}
      <span className="flex-1 text-text-primary truncate" title={template.prompt}>
        {template.name}
      </span>
      {editMode && (
        <>
          {scope === 'project' ? (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onCopyToGlobal(template)
              }}
              className="text-sm text-text-muted hover:text-green-400 transition-colors px-1"
              title="Move to Global"
            >
              ↑G
            </button>
          ) : (
            <button
              onClick={(e) => {
                e.stopPropagation()
                onCopyToProject(template)
              }}
              className="text-sm text-text-muted hover:text-green-400 transition-colors px-1"
              title="Copy to Project"
            >
              ↓P
            </button>
          )}
          <button
            onClick={(e) => {
              e.stopPropagation()
              onDelete(template.id, scope)
            }}
            className="text-sm text-text-muted hover:text-red-400 transition-colors px-1"
            title="Delete"
          >
            <X size={16} />
          </button>
        </>
      )}
    </div>
  )
}

function TemplateSection({
  title,
  scope,
  templates,
  editMode,
  showForm,
  editingTemplate,
  onStartAdd,
  renderInlineEditForm,
  renderTemplateItem,
}: {
  title: string
  scope: 'project' | 'global'
  templates: PromptTemplate[]
  editMode: boolean
  showForm: 'project' | 'global' | null
  editingTemplate: PromptTemplate | null
  onStartAdd: (scope: 'project' | 'global') => void
  renderInlineEditForm: (template: PromptTemplate, scope: 'project' | 'global') => React.ReactNode
  renderTemplateItem: (
    template: PromptTemplate,
    index: number,
    scope: 'project' | 'global'
  ) => React.ReactNode
}) {
  return (
    <div>
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-sm font-medium text-text-tertiary">{title}</h3>
        {editMode && showForm !== scope && (
          <button
            type="button"
            onClick={() => onStartAdd(scope)}
            className="text-xs px-2 py-1 bg-control-bg text-text-tertiary rounded hover:bg-control-bg-hover hover:text-text-secondary transition-colors"
          >
            + Add
          </button>
        )}
      </div>
      {showForm === scope && !editingTemplate && (
        <div className="mb-2">{renderInlineEditForm({ id: '', name: '', prompt: '' }, scope)}</div>
      )}
      {templates.length === 0 && showForm !== scope ? (
        <div className="text-text-muted text-sm py-2">No {title.toLowerCase()} yet.</div>
      ) : (
        <div className="space-y-2">
          {templates.map((template, index) => renderTemplateItem(template, index, scope))}
        </div>
      )}
    </div>
  )
}

interface PromptTemplatesProps {
  sessionName?: string | null
  onFocusTerminal?: () => void
}

export default function PromptTemplates({ sessionName, onFocusTerminal }: PromptTemplatesProps) {
  const [projectTemplates, setProjectTemplates] = useState<PromptTemplate[]>([])
  const [globalTemplates, setGlobalTemplates] = useState<PromptTemplate[]>([])
  const [loading, setLoading] = useState(!!sessionName)
  const [saving, setSaving] = useState(false)
  const [editMode, setEditMode] = useState(false)
  const [editingTemplate, setEditingTemplate] = useState<PromptTemplate | null>(null)
  const [showForm, setShowForm] = useState<'project' | 'global' | null>(null)
  const [formName, setFormName, clearFormName] = useLocalStorageDraft(
    `prompt-form:${sessionName}:name`
  )
  const [formPrompt, setFormPrompt, clearFormPrompt] = useLocalStorageDraft(
    `prompt-form:${sessionName}:prompt`
  )
  const [dragIndex, setDragIndex] = useState<number | null>(null)
  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null)
  const [dragScope, setDragScope] = useState<'project' | 'global' | null>(null)

  useEffect(() => {
    if (!sessionName) return
    Promise.all([
      fetch(`${getApiBase()}/sessions/${sessionName}/prompts`).then((res) => res.json()),
      fetch(`${getApiBase()}/global/prompts`).then((res) => res.json()),
    ])
      .then(([projectData, globalData]) => {
        setProjectTemplates(projectData.templates || [])
        setGlobalTemplates(globalData.templates || [])
        setLoading(false)
      })
      .catch((err) => {
        console.error('Failed to fetch prompts:', err)
        setLoading(false)
      })
  }, [sessionName])

  const saveProjectTemplates = async (templates: PromptTemplate[]) => {
    if (!sessionName) return
    setSaving(true)
    try {
      await fetch(`${getApiBase()}/sessions/${sessionName}/prompts`, {
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
      await fetch(`${getApiBase()}/global/prompts`, {
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
      await fetch(`${getApiBase()}/session/${sessionName}/send`, {
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

    // Sanitize name: replace spaces with underscores, remove invalid chars
    const sanitizedName = formName
      .trim()
      .replace(/\s+/g, '_')
      .replace(/[^a-zA-Z0-9_-]/g, '')

    if (!sanitizedName) return

    const newTemplate: PromptTemplate = {
      id: editingTemplate?.id || generateId(),
      name: sanitizedName,
      prompt: formPrompt.trim(),
    }

    if (showForm === 'project') {
      const updated = editingTemplate
        ? projectTemplates.map((t) => (t.id === editingTemplate.id ? newTemplate : t))
        : [...projectTemplates, newTemplate]
      setProjectTemplates(updated)
      saveProjectTemplates(updated)
    } else {
      const updated = editingTemplate
        ? globalTemplates.map((t) => (t.id === editingTemplate.id ? newTemplate : t))
        : [...globalTemplates, newTemplate]
      setGlobalTemplates(updated)
      saveGlobalTemplates(updated)
    }

    // Reset form
    clearFormName()
    clearFormPrompt()
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
    clearFormName()
    clearFormPrompt()
    setShowForm(null)
  }

  const handleStartAdd = (scope: 'project' | 'global') => {
    setEditingTemplate(null)
    // Don't clear drafts - localStorage may have unsaved content from a previous session
    setShowForm(scope)
  }

  const handleDelete = (id: string, scope: 'project' | 'global') => {
    if (scope === 'project') {
      const updated = projectTemplates.filter((t) => t.id !== id)
      setProjectTemplates(updated)
      saveProjectTemplates(updated)
    } else {
      const updated = globalTemplates.filter((t) => t.id !== id)
      setGlobalTemplates(updated)
      saveGlobalTemplates(updated)
    }
    if (editingTemplate?.id === id) {
      handleCancelEdit()
    }
  }

  const handleCopyToGlobal = async (template: PromptTemplate) => {
    if (!sessionName) return
    try {
      await fetch(`${getApiBase()}/sessions/${sessionName}/prompts/${template.id}/copy-to-global`, {
        method: 'POST',
      })
      // Refresh both lists
      const [projectData, globalData] = await Promise.all([
        fetch(`${getApiBase()}/sessions/${sessionName}/prompts`).then((res) => res.json()),
        fetch(`${getApiBase()}/global/prompts`).then((res) => res.json()),
      ])
      setProjectTemplates(projectData.templates || [])
      setGlobalTemplates(globalData.templates || [])
    } catch (err) {
      console.error('Failed to copy to global:', err)
    }
  }

  const handleCopyToProject = async (template: PromptTemplate) => {
    if (!sessionName) return
    try {
      await fetch(
        `${getApiBase()}/sessions/${sessionName}/global/prompts/${template.id}/copy-to-project`,
        {
          method: 'POST',
        }
      )
      // Refresh project list
      const projectData = await fetch(`${getApiBase()}/sessions/${sessionName}/prompts`).then(
        (res) => res.json()
      )
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
    return <div className="flex items-center justify-center h-full text-text-muted">Loading...</div>
  }

  const editFormRef = (el: HTMLDivElement | null) => {
    if (!el) return
    const parent = el.closest('.overflow-y-auto')
    if (!parent) return
    const parentRect = parent.getBoundingClientRect()
    const elRect = el.getBoundingClientRect()
    const available = (parentRect.bottom - elRect.top) * 0.65 // use ~65% of available space
    const textarea = el.querySelector('textarea')
    if (textarea) {
      textarea.style.height = `${Math.max(120, available)}px`
    }
  }

  const renderInlineEditForm = (template: PromptTemplate, _scope: 'project' | 'global') => (
    <div
      key={template.id}
      ref={editFormRef}
      className="p-3 bg-bg-surface rounded border border-blue-500"
    >
      <div className="mb-2">
        <input
          type="text"
          value={formName}
          onChange={(e) => setFormName(e.target.value)}
          placeholder="Template name"
          autoFocus
          className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500"
        />
      </div>
      <div className="mb-2">
        <textarea
          value={formPrompt}
          onChange={(e) => setFormPrompt(e.target.value)}
          placeholder="Prompt text..."
          className="w-full min-h-[120px] px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 resize-vertical"
        />
      </div>
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={handleSaveTemplate}
          disabled={!formName.trim() || !formPrompt.trim()}
          className="px-3 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-500 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
        >
          Save
        </button>
        <button
          type="button"
          onClick={handleCancelEdit}
          className="px-3 py-1.5 bg-control-bg text-text-tertiary text-sm rounded hover:bg-control-bg-hover hover:text-text-secondary transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  )

  const renderTemplateItem = (
    template: PromptTemplate,
    index: number,
    scope: 'project' | 'global'
  ) => {
    if (editMode && editingTemplate?.id === template.id && showForm === scope) {
      return renderInlineEditForm(template, scope)
    }

    return (
      <TemplateItem
        key={template.id}
        template={template}
        index={index}
        scope={scope}
        editMode={editMode}
        sessionName={sessionName}
        isDragging={dragScope === scope && dragIndex === index}
        isDragOver={dragScope === scope && dragOverIndex === index && dragIndex !== index}
        onDragStart={handleDragStart}
        onDragOver={handleDragOver}
        onDragEnd={handleDragEnd}
        onEdit={handleEdit}
        onSendToTerminal={handleSendToTerminal}
        onCopyToGlobal={handleCopyToGlobal}
        onCopyToProject={handleCopyToProject}
        onDelete={handleDelete}
      />
    )
  }

  return (
    <div className="h-full flex flex-col p-4 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-text-secondary">Prompt Templates</h2>
        <button
          onClick={() => {
            if (editMode) handleCancelEdit()
            setEditMode(!editMode)
          }}
          className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
            editMode
              ? 'bg-blue-600 text-white hover:bg-blue-500'
              : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
          }`}
        >
          {editMode ? 'Done' : 'Edit'}
        </button>
      </div>

      {/* Template lists */}
      <div className="flex-1 overflow-y-auto space-y-4">
        <TemplateSection
          title="Project Templates"
          scope="project"
          templates={projectTemplates}
          editMode={editMode}
          showForm={showForm}
          editingTemplate={editingTemplate}
          onStartAdd={handleStartAdd}
          renderInlineEditForm={renderInlineEditForm}
          renderTemplateItem={renderTemplateItem}
        />
        <TemplateSection
          title="Global Templates"
          scope="global"
          templates={globalTemplates}
          editMode={editMode}
          showForm={showForm}
          editingTemplate={editingTemplate}
          onStartAdd={handleStartAdd}
          renderInlineEditForm={renderInlineEditForm}
          renderTemplateItem={renderTemplateItem}
        />
      </div>

      {/* Saving indicator */}
      {saving && <div className="text-text-muted text-sm text-center py-2">Saving...</div>}
    </div>
  )
}
