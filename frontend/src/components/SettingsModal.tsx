import { useState, useEffect, useCallback } from 'react'

interface Props {
  apiHost: string
  onClose: () => void
}

interface AIProviderConfig {
  baseUrl?: string
  apiKey?: string
  model?: string
}

interface AISettings {
  provider: string
  providers: Record<string, AIProviderConfig>
}

interface Settings {
  repoSearchDir: string
  ai: AISettings
}

interface OllamaModel {
  name: string
  size: number
  parameter_size: string
}

type TabId = 'general' | 'ai'

// Provider configuration - data-driven approach
interface ProviderDef {
  id: string
  label: string
  fields: FieldDef[]
  defaultModel: string
}

interface FieldDef {
  key: 'baseUrl' | 'apiKey' | 'model'
  label: string
  type: 'text' | 'password' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
}

const PROVIDERS: ProviderDef[] = [
  {
    id: 'ollama',
    label: 'Ollama (Local)',
    defaultModel: '',
    fields: [
      { key: 'baseUrl', label: 'Base URL', type: 'text', placeholder: 'http://localhost:11434' },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'llama3.2' },
    ],
  },
  {
    id: 'openai',
    label: 'OpenAI',
    defaultModel: 'gpt-4o',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-...' },
      {
        key: 'model',
        label: 'Model',
        type: 'select',
        options: [
          { value: 'gpt-4o', label: 'gpt-4o' },
          { value: 'gpt-4o-mini', label: 'gpt-4o-mini' },
          { value: 'gpt-4-turbo', label: 'gpt-4-turbo' },
          { value: 'gpt-3.5-turbo', label: 'gpt-3.5-turbo' },
        ],
      },
    ],
  },
  {
    id: 'anthropic',
    label: 'Anthropic',
    defaultModel: 'claude-sonnet-4-20250514',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'sk-ant-...' },
      {
        key: 'model',
        label: 'Model',
        type: 'select',
        options: [
          { value: 'claude-sonnet-4-20250514', label: 'claude-sonnet-4-20250514' },
          { value: 'claude-opus-4-20250514', label: 'claude-opus-4-20250514' },
          { value: 'claude-3-5-sonnet-20241022', label: 'claude-3-5-sonnet-20241022' },
          { value: 'claude-3-5-haiku-20241022', label: 'claude-3-5-haiku-20241022' },
        ],
      },
    ],
  },
  {
    id: 'google',
    label: 'Google AI',
    defaultModel: 'gemini-3-flash-preview',
    fields: [
      { key: 'apiKey', label: 'API Key', type: 'password', placeholder: 'AIza...' },
      {
        key: 'model',
        label: 'Model',
        type: 'select',
        options: [
          { value: 'gemini-3-flash-preview', label: 'gemini-3-flash-preview (1M context)' },
          { value: 'gemini-2.5-flash', label: 'gemini-2.5-flash' },
          { value: 'gemini-2.5-flash-lite', label: 'gemini-2.5-flash-lite' },
        ],
      },
    ],
  },
  {
    id: 'openai_compatible',
    label: 'OpenAI Compatible',
    defaultModel: '',
    fields: [
      {
        key: 'baseUrl',
        label: 'Base URL',
        type: 'text',
        placeholder: 'https://api.example.com/v1',
      },
      { key: 'apiKey', label: 'API Key (optional)', type: 'password', placeholder: 'your-api-key' },
      { key: 'model', label: 'Model', type: 'text', placeholder: 'model-name' },
    ],
  },
]

export default function SettingsModal({ apiHost, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [repoSearchDir, setRepoSearchDir] = useState('')
  const [aiProvider, setAiProvider] = useState('ollama')
  const [providerConfigs, setProviderConfigs] = useState<Record<string, AIProviderConfig>>(() => {
    const initial: Record<string, AIProviderConfig> = {}
    PROVIDERS.forEach((p) => {
      initial[p.id] = {
        baseUrl: p.id === 'ollama' ? 'http://localhost:11434' : '',
        apiKey: '',
        model: p.defaultModel,
      }
    })
    return initial
  })
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`http://${apiHost}/api/settings`)
        if (!res.ok) throw new Error('Failed to fetch settings')
        const data: Settings = await res.json()
        setRepoSearchDir(data.repoSearchDir || '')

        if (data.ai) {
          setAiProvider(data.ai.provider || 'ollama')
          if (data.ai.providers) {
            setProviderConfigs((prev) => {
              const updated = { ...prev }
              Object.entries(data.ai.providers).forEach(([id, config]) => {
                if (updated[id]) {
                  updated[id] = { ...updated[id], ...config }
                }
              })
              return updated
            })
          }
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings')
      } finally {
        setIsLoading(false)
      }
    }
    fetchSettings()
  }, [apiHost])

  const fetchOllamaModels = useCallback(async () => {
    setIsLoadingModels(true)
    try {
      const res = await fetch(`http://${apiHost}/api/ai/ollama/models`)
      if (res.ok) {
        const models = await res.json()
        setOllamaModels(models)
      }
    } catch {
      // Ollama might not be running, that's fine
    } finally {
      setIsLoadingModels(false)
    }
  }, [apiHost])

  useEffect(() => {
    if (activeTab === 'ai') {
      fetchOllamaModels()
    }
  }, [activeTab, fetchOllamaModels])

  const updateProviderConfig = (providerId: string, key: string, value: string) => {
    setProviderConfigs((prev) => ({
      ...prev,
      [providerId]: { ...prev[providerId], [key]: value },
    }))
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = {}
      if (repoSearchDir.trim()) {
        payload.repoSearchDir = repoSearchDir.trim()
      }
      payload.ai = {
        provider: aiProvider,
        providers: providerConfigs,
      }

      const res = await fetch(`http://${apiHost}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to save settings')
      }

      await res.json()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const formatSize = (bytes: number) => {
    const gb = bytes / (1024 * 1024 * 1024)
    return `${gb.toFixed(1)} GB`
  }

  const renderField = (providerId: string, field: FieldDef) => {
    const config = providerConfigs[providerId]
    const value = config?.[field.key] || ''

    // Special handling for Ollama model field with dynamic model list
    if (providerId === 'ollama' && field.key === 'model') {
      if (isLoadingModels) {
        return <div className="text-gray-500 text-sm py-2">Loading models...</div>
      }
      if (ollamaModels.length > 0) {
        return (
          <select
            value={value}
            onChange={(e) => updateProviderConfig(providerId, field.key, e.target.value)}
            className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 text-sm"
          >
            <option value="">Select a model</option>
            {ollamaModels.map((model) => (
              <option key={model.name} value={model.name}>
                {model.name} ({model.parameter_size}, {formatSize(model.size)})
              </option>
            ))}
          </select>
        )
      }
      // Fall through to text input if no models
    }

    if (field.type === 'select' && field.options) {
      return (
        <select
          value={value}
          onChange={(e) => updateProviderConfig(providerId, field.key, e.target.value)}
          className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 text-sm"
        >
          {field.options.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </select>
      )
    }

    return (
      <input
        type={field.type}
        value={value}
        onChange={(e) => updateProviderConfig(providerId, field.key, e.target.value)}
        placeholder={field.placeholder}
        className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
      />
    )
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'ai', label: 'AI' },
  ]

  const currentProvider = PROVIDERS.find((p) => p.id === aiProvider)

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-lg border border-gray-700">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-white transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-gray-400 hover:text-white'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-gray-400">Loading settings...</div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* General Tab */}
            {activeTab === 'general' && (
              <div>
                <label className="block text-sm text-gray-400 mb-1">
                  Repository Search Directory
                </label>
                <input
                  type="text"
                  value={repoSearchDir}
                  onChange={(e) => setRepoSearchDir(e.target.value)}
                  placeholder="e.g., ~/src or /home/user/projects"
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
                />
                <p className="text-xs text-gray-500 mt-1">
                  Directory to search for git repositories
                </p>
              </div>
            )}

            {/* AI Tab */}
            {activeTab === 'ai' && (
              <div className="space-y-4">
                {/* Provider selector */}
                <div>
                  <label className="block text-sm text-gray-400 mb-1">AI Provider</label>
                  <select
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 text-sm"
                  >
                    {PROVIDERS.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </div>

                {/* Provider-specific fields (data-driven) */}
                {currentProvider && (
                  <div className="space-y-3 p-3 bg-gray-700/50 rounded">
                    {currentProvider.fields.map((field) => (
                      <div key={field.key}>
                        <label className="block text-sm text-gray-400 mb-1">{field.label}</label>
                        {renderField(currentProvider.id, field)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {error && <div className="text-red-400 text-sm">{error}</div>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-gray-400 hover:text-white transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
              >
                {isSaving ? 'Saving...' : 'Save'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  )
}
