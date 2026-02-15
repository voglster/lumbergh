import { useState, useEffect } from 'react'

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
  providers: {
    ollama: AIProviderConfig
    openai: AIProviderConfig
    anthropic: AIProviderConfig
    google: AIProviderConfig
    openai_compatible: AIProviderConfig
  }
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

export default function SettingsModal({ apiHost, onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [repoSearchDir, setRepoSearchDir] = useState('')
  const [aiProvider, setAiProvider] = useState('ollama')
  const [ollamaBaseUrl, setOllamaBaseUrl] = useState('http://localhost:11434')
  const [ollamaModel, setOllamaModel] = useState('')
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [openaiApiKey, setOpenaiApiKey] = useState('')
  const [openaiModel, setOpenaiModel] = useState('gpt-4o')
  const [anthropicApiKey, setAnthropicApiKey] = useState('')
  const [anthropicModel, setAnthropicModel] = useState('claude-sonnet-4-20250514')
  const [googleApiKey, setGoogleApiKey] = useState('')
  const [googleModel, setGoogleModel] = useState('gemini-3-flash-preview')
  const [compatibleBaseUrl, setCompatibleBaseUrl] = useState('')
  const [compatibleApiKey, setCompatibleApiKey] = useState('')
  const [compatibleModel, setCompatibleModel] = useState('')
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

        // AI settings
        if (data.ai) {
          setAiProvider(data.ai.provider || 'ollama')
          if (data.ai.providers?.ollama) {
            setOllamaBaseUrl(data.ai.providers.ollama.baseUrl || 'http://localhost:11434')
            setOllamaModel(data.ai.providers.ollama.model || '')
          }
          if (data.ai.providers?.openai) {
            setOpenaiApiKey(data.ai.providers.openai.apiKey || '')
            setOpenaiModel(data.ai.providers.openai.model || 'gpt-4o')
          }
          if (data.ai.providers?.anthropic) {
            setAnthropicApiKey(data.ai.providers.anthropic.apiKey || '')
            setAnthropicModel(data.ai.providers.anthropic.model || 'claude-sonnet-4-20250514')
          }
          if (data.ai.providers?.google) {
            setGoogleApiKey(data.ai.providers.google.apiKey || '')
            setGoogleModel(data.ai.providers.google.model || 'gemini-3-flash-preview')
          }
          if (data.ai.providers?.openai_compatible) {
            setCompatibleBaseUrl(data.ai.providers.openai_compatible.baseUrl || '')
            setCompatibleApiKey(data.ai.providers.openai_compatible.apiKey || '')
            setCompatibleModel(data.ai.providers.openai_compatible.model || '')
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

  // Fetch Ollama models when on AI tab
  useEffect(() => {
    if (activeTab === 'ai') {
      fetchOllamaModels()
    }
  }, [activeTab, apiHost])

  const fetchOllamaModels = async () => {
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
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsSaving(true)
    setError(null)

    try {
      const payload: Record<string, unknown> = {}

      // General settings
      if (repoSearchDir.trim()) {
        payload.repoSearchDir = repoSearchDir.trim()
      }

      // AI settings
      payload.ai = {
        provider: aiProvider,
        providers: {
          ollama: {
            baseUrl: ollamaBaseUrl,
            model: ollamaModel,
          },
          openai: {
            apiKey: openaiApiKey,
            model: openaiModel,
          },
          anthropic: {
            apiKey: anthropicApiKey,
            model: anthropicModel,
          },
          google: {
            apiKey: googleApiKey,
            model: googleModel,
          },
          openai_compatible: {
            baseUrl: compatibleBaseUrl,
            apiKey: compatibleApiKey,
            model: compatibleModel,
          },
        },
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

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'ai', label: 'AI' },
  ]

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-lg border border-gray-700">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">Settings</h2>
          <button
            onClick={onClose}
            className="text-gray-400 hover:text-white transition-colors"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-gray-700">
          {tabs.map(tab => (
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
          <div className="p-8 text-center text-gray-400">
            Loading settings...
          </div>
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
                  onChange={e => setRepoSearchDir(e.target.value)}
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
                  <label className="block text-sm text-gray-400 mb-1">
                    AI Provider
                  </label>
                  <select
                    value={aiProvider}
                    onChange={e => setAiProvider(e.target.value)}
                    className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 text-sm"
                  >
                    <option value="ollama">Ollama (Local)</option>
                    <option value="openai">OpenAI</option>
                    <option value="anthropic">Anthropic</option>
                    <option value="google">Google AI</option>
                    <option value="openai_compatible">OpenAI Compatible</option>
                  </select>
                </div>

                {/* Ollama settings */}
                {aiProvider === 'ollama' && (
                  <div className="space-y-3 p-3 bg-gray-700/50 rounded">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        Base URL
                      </label>
                      <input
                        type="text"
                        value={ollamaBaseUrl}
                        onChange={e => setOllamaBaseUrl(e.target.value)}
                        placeholder="http://localhost:11434"
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        Model
                      </label>
                      {isLoadingModels ? (
                        <div className="text-gray-500 text-sm py-2">Loading models...</div>
                      ) : ollamaModels.length > 0 ? (
                        <select
                          value={ollamaModel}
                          onChange={e => setOllamaModel(e.target.value)}
                          className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 text-sm"
                        >
                          <option value="">Select a model</option>
                          {ollamaModels.map(model => (
                            <option key={model.name} value={model.name}>
                              {model.name} ({model.parameter_size}, {formatSize(model.size)})
                            </option>
                          ))}
                        </select>
                      ) : (
                        <input
                          type="text"
                          value={ollamaModel}
                          onChange={e => setOllamaModel(e.target.value)}
                          placeholder="llama3.2"
                          className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
                        />
                      )}
                    </div>
                  </div>
                )}

                {/* OpenAI settings */}
                {aiProvider === 'openai' && (
                  <div className="space-y-3 p-3 bg-gray-700/50 rounded">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={openaiApiKey}
                        onChange={e => setOpenaiApiKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        Model
                      </label>
                      <select
                        value={openaiModel}
                        onChange={e => setOpenaiModel(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 text-sm"
                      >
                        <option value="gpt-4o">gpt-4o</option>
                        <option value="gpt-4o-mini">gpt-4o-mini</option>
                        <option value="gpt-4-turbo">gpt-4-turbo</option>
                        <option value="gpt-3.5-turbo">gpt-3.5-turbo</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Anthropic settings */}
                {aiProvider === 'anthropic' && (
                  <div className="space-y-3 p-3 bg-gray-700/50 rounded">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={anthropicApiKey}
                        onChange={e => setAnthropicApiKey(e.target.value)}
                        placeholder="sk-ant-..."
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        Model
                      </label>
                      <select
                        value={anthropicModel}
                        onChange={e => setAnthropicModel(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 text-sm"
                      >
                        <option value="claude-sonnet-4-20250514">claude-sonnet-4-20250514</option>
                        <option value="claude-opus-4-20250514">claude-opus-4-20250514</option>
                        <option value="claude-3-5-sonnet-20241022">claude-3-5-sonnet-20241022</option>
                        <option value="claude-3-5-haiku-20241022">claude-3-5-haiku-20241022</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* Google AI settings */}
                {aiProvider === 'google' && (
                  <div className="space-y-3 p-3 bg-gray-700/50 rounded">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        API Key
                      </label>
                      <input
                        type="password"
                        value={googleApiKey}
                        onChange={e => setGoogleApiKey(e.target.value)}
                        placeholder="AIza..."
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        Model
                      </label>
                      <select
                        value={googleModel}
                        onChange={e => setGoogleModel(e.target.value)}
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 text-sm"
                      >
                        <option value="gemini-3-flash-preview">gemini-3-flash-preview (1M context)</option>
                        <option value="gemini-2.5-flash">gemini-2.5-flash</option>
                        <option value="gemini-2.5-flash-lite">gemini-2.5-flash-lite</option>
                      </select>
                    </div>
                  </div>
                )}

                {/* OpenAI Compatible settings */}
                {aiProvider === 'openai_compatible' && (
                  <div className="space-y-3 p-3 bg-gray-700/50 rounded">
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        Base URL
                      </label>
                      <input
                        type="text"
                        value={compatibleBaseUrl}
                        onChange={e => setCompatibleBaseUrl(e.target.value)}
                        placeholder="https://api.example.com/v1"
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        API Key (optional)
                      </label>
                      <input
                        type="password"
                        value={compatibleApiKey}
                        onChange={e => setCompatibleApiKey(e.target.value)}
                        placeholder="your-api-key"
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
                      />
                    </div>
                    <div>
                      <label className="block text-sm text-gray-400 mb-1">
                        Model
                      </label>
                      <input
                        type="text"
                        value={compatibleModel}
                        onChange={e => setCompatibleModel(e.target.value)}
                        placeholder="model-name"
                        className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {error && (
              <div className="text-red-400 text-sm">{error}</div>
            )}

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
