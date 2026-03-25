import { useState, useEffect } from 'react'
import { getApiBase } from '../config'
import AgentProviderSelect from './create-session/AgentProviderSelect'

interface SessionUpdate {
  displayName?: string
  description?: string
  agentProvider?: string
  tabVisibility?: Record<string, boolean>
}

interface Props {
  sessionName: string
  displayName: string | null
  description: string | null
  agentProvider: string | null
  tabVisibility: Record<string, boolean> | null
  onSave: (name: string, updates: SessionUpdate) => void
  onCancel: () => void
}

export default function SessionCardEditForm({
  sessionName,
  displayName,
  description,
  agentProvider: currentAgentProvider,
  tabVisibility: currentTabVisibility,
  onSave,
  onCancel,
}: Props) {
  const [editName, setEditName] = useState(displayName || sessionName)
  const [editDescription, setEditDescription] = useState(description || '')
  const [editAgentProvider, setEditAgentProvider] = useState(currentAgentProvider || '')
  const [agentProviders, setAgentProviders] = useState<Record<string, { label: string }>>({})
  const [defaultAgent, setDefaultAgent] = useState('')
  const [customizeTabs, setCustomizeTabs] = useState(!!currentTabVisibility)
  const [globalTabVisibility, setGlobalTabVisibility] = useState<Record<string, boolean>>({
    git: true,
    files: true,
    todos: true,
    prompts: true,
    shared: true,
  })
  const [editTabVisibility, setEditTabVisibility] = useState<Record<string, boolean>>(
    currentTabVisibility || { git: true, files: true, todos: true, prompts: true, shared: true }
  )

  useEffect(() => {
    fetch(`${getApiBase()}/settings`)
      .then((res) => res.json())
      .then((data) => {
        if (data.agentProviders) setAgentProviders(data.agentProviders)
        if (data.defaultAgent) setDefaultAgent(data.defaultAgent)
        if (data.tabVisibility) {
          setGlobalTabVisibility(data.tabVisibility)
          if (!currentTabVisibility) setEditTabVisibility(data.tabVisibility)
        }
      })
      .catch(() => {})
  }, [currentTabVisibility])

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault()
    e.stopPropagation()

    const updates: SessionUpdate = {}
    const trimmedName = editName.trim()
    const trimmedDesc = editDescription.trim()

    if (trimmedName !== (displayName || '')) {
      updates.displayName = trimmedName
    }
    if (trimmedDesc !== (description || '')) {
      updates.description = trimmedDesc
    }
    const effectiveCurrentAgent = currentAgentProvider || defaultAgent
    if (editAgentProvider && editAgentProvider !== effectiveCurrentAgent) {
      updates.agentProvider = editAgentProvider
    }
    if (customizeTabs) {
      updates.tabVisibility = editTabVisibility
    } else if (currentTabVisibility) {
      // Was custom, now reset to default — send global defaults to clear override
      updates.tabVisibility = globalTabVisibility
    }

    if (Object.keys(updates).length > 0) {
      onSave(sessionName, updates)
    }
    onCancel()
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      onCancel()
    }
  }

  return (
    <div
      onClick={(e) => e.stopPropagation()}
      className="bg-bg-surface rounded-lg p-4 border border-blue-500"
    >
      <form onSubmit={handleSubmit} className="space-y-3">
        <div>
          <label className="block text-xs text-text-tertiary mb-1">Display Name</label>
          <input
            type="text"
            value={editName}
            onChange={(e) => setEditName(e.target.value)}
            onKeyDown={handleKeyDown}
            autoFocus
            className="w-full bg-control-bg text-text-primary px-2 py-1.5 rounded border border-border-subtle focus:border-blue-500 focus:outline-none text-sm"
            placeholder={sessionName}
          />
        </div>
        <div>
          <label className="block text-xs text-text-tertiary mb-1">Description</label>
          <input
            type="text"
            value={editDescription}
            onChange={(e) => setEditDescription(e.target.value)}
            onKeyDown={handleKeyDown}
            className="w-full bg-control-bg text-text-primary px-2 py-1.5 rounded border border-border-subtle focus:border-blue-500 focus:outline-none text-sm"
            placeholder="Optional description"
          />
        </div>
        <AgentProviderSelect
          agentProviders={agentProviders}
          agentProvider={editAgentProvider || currentAgentProvider || ''}
          defaultAgent={defaultAgent}
          onAgentProviderChange={setEditAgentProvider}
        />
        <div>
          <label className="flex items-center gap-2 text-xs text-text-tertiary">
            <input
              type="checkbox"
              checked={customizeTabs}
              onChange={() => {
                if (customizeTabs) {
                  setEditTabVisibility(globalTabVisibility)
                }
                setCustomizeTabs(!customizeTabs)
              }}
              className="rounded border-input-border bg-input-bg"
            />
            Custom tab visibility
          </label>
          {customizeTabs && (
            <div className="mt-1.5 ml-5 space-y-1.5">
              <label className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={Object.values(editTabVisibility).every((v) => !v)}
                  onChange={() => {
                    const allOff = Object.values(editTabVisibility).every((v) => !v)
                    if (allOff) {
                      setEditTabVisibility(globalTabVisibility)
                    } else {
                      setEditTabVisibility(
                        Object.fromEntries(Object.keys(editTabVisibility).map((k) => [k, false]))
                      )
                    }
                  }}
                  className="rounded border-input-border bg-input-bg"
                />
                <span className="text-text-secondary font-medium">Terminal only</span>
              </label>
              <div className="flex flex-wrap gap-2">
                {(
                  [
                    ['git', 'Git'],
                    ['files', 'Files'],
                    ['todos', 'Todos'],
                    ['prompts', 'Prompts'],
                    ['shared', 'Shared'],
                  ] as const
                ).map(([key, label]) => {
                  const isEnabled = editTabVisibility[key] !== false
                  return (
                    <label key={key} className="flex items-center gap-1 text-xs">
                      <input
                        type="checkbox"
                        checked={isEnabled}
                        onChange={() =>
                          setEditTabVisibility((prev) => ({ ...prev, [key]: !prev[key] }))
                        }
                        className="rounded border-input-border bg-input-bg"
                      />
                      <span className="text-text-secondary">{label}</span>
                    </label>
                  )
                })}
              </div>
            </div>
          )}
        </div>
        <div className="flex justify-end gap-2">
          <button
            type="button"
            onClick={onCancel}
            className="px-3 py-1 text-sm text-text-tertiary hover:text-text-primary transition-colors"
          >
            Cancel
          </button>
          <button
            type="submit"
            className="px-3 py-1 text-sm bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors"
          >
            Save
          </button>
        </div>
      </form>
    </div>
  )
}
