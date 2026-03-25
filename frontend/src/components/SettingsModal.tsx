import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import CloudSettings from './CloudSettings'
import SecuritySettings from './SecuritySettings'
import { getApiBase } from '../config'

interface Props {
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
  gitGraphCommits: number
  ai: AISettings
  defaultAgent?: string
  agentProviders?: Record<string, { label: string }>
  passwordSet?: boolean
  passwordSource?: string | null
  telemetryConsent?: boolean | null
  cloudUsername?: string
  tabVisibility?: Record<string, boolean>
}

interface OllamaModel {
  name: string
  size: number
  parameter_size: string
}

interface CloudModel {
  name: string
}

type TabId = 'general' | 'ai' | 'cloud' | 'security'

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
  {
    id: 'lumbergh_cloud',
    label: 'Lumbergh Cloud (Free)',
    defaultModel: '',
    fields: [{ key: 'model', label: 'Model', type: 'text', placeholder: 'llama3.2' }],
  },
]

export default function SettingsModal({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [repoSearchDir, setRepoSearchDir] = useState('')
  const [gitGraphCommits, setGitGraphCommits] = useState('100')
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
  const [telemetryConsent, setTelemetryConsent] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordSet, setPasswordSet] = useState(false)
  const [passwordSource, setPasswordSource] = useState<string | null>(null)
  const [passwordChanged, setPasswordChanged] = useState(false)
  const [telemetryGuiltTrip, setTelemetryGuiltTrip] = useState<{
    quote: string
    speaker: string
    isMilton: boolean
  } | null>(null)
  const [defaultAgent, setDefaultAgent] = useState('claude-code')
  const [agentProviders, setAgentProviders] = useState<Record<string, { label: string }>>({})
  const [tabVisibility, setTabVisibility] = useState<Record<string, boolean>>({
    git: true,
    files: true,
    todos: true,
    prompts: true,
    shared: true,
  })
  const [cloudUsername, setCloudUsername] = useState<string | null>(null)
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [cloudModels, setCloudModels] = useState<CloudModel[]>([])
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [restartNeeded, setRestartNeeded] = useState(false)
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  const applyAiSettings = useCallback((ai: AISettings) => {
    setAiProvider(ai.provider || 'ollama')
    if (ai.providers) {
      setProviderConfigs((prev) => {
        const updated = { ...prev }
        Object.entries(ai.providers).forEach(([id, config]) => {
          if (updated[id]) {
            updated[id] = { ...updated[id], ...config }
          }
        })
        return updated
      })
    }
  }, [])

  const fetchSettings = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/settings`)
      if (!res.ok) throw new Error('Failed to fetch settings')
      const data: Settings = await res.json()
      setRepoSearchDir(data.repoSearchDir || '')
      if (data.gitGraphCommits) setGitGraphCommits(String(data.gitGraphCommits))
      setPasswordSet(data.passwordSet ?? false)
      setPasswordSource(data.passwordSource ?? null)
      setTelemetryConsent(data.telemetryConsent ?? false)
      setCloudUsername(data.cloudUsername ?? null)
      if (data.defaultAgent) setDefaultAgent(data.defaultAgent)
      if (data.agentProviders) setAgentProviders(data.agentProviders)
      if (data.tabVisibility) setTabVisibility(data.tabVisibility)
      if (data.ai) applyAiSettings(data.ai)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load settings')
    } finally {
      setIsLoading(false)
    }
  }, [applyAiSettings])

  useEffect(() => {
    fetchSettings()
  }, [fetchSettings])

  const fetchOllamaModels = useCallback(async () => {
    setIsLoadingModels(true)
    try {
      const res = await fetch(`${getApiBase()}/ai/ollama/models`)
      if (res.ok) {
        const models = await res.json()
        setOllamaModels(models)
      }
    } catch {
      // Ollama might not be running, that's fine
    } finally {
      setIsLoadingModels(false)
    }
  }, [])

  const fetchCloudModels = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/ai/cloud/models`)
      if (res.ok) {
        const models = await res.json()
        setCloudModels(models)
      }
    } catch {
      // Cloud might not be connected, that's fine
    }
  }, [])

  useEffect(() => {
    if (activeTab === 'ai') {
      fetchOllamaModels()
      if (cloudUsername) fetchCloudModels()
    }
  }, [activeTab, fetchOllamaModels, fetchCloudModels, cloudUsername])

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
      const parsedCommits = parseInt(gitGraphCommits) || 100
      payload.gitGraphCommits = Math.min(1000, Math.max(10, parsedCommits))
      payload.telemetryConsent = telemetryConsent
      payload.defaultAgent = defaultAgent
      payload.tabVisibility = tabVisibility
      payload.ai = {
        provider: aiProvider,
        providers: providerConfigs,
      }
      if (passwordChanged) {
        payload.password = password
      }

      const res = await fetch(`${getApiBase()}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to save settings')
      }

      await res.json()
      if (passwordChanged) {
        setRestartNeeded(true)
      } else {
        onClose()
      }
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

    // Special handling for Lumbergh Cloud model field with dynamic model list
    if (providerId === 'lumbergh_cloud' && field.key === 'model') {
      if (cloudModels.length > 0) {
        return (
          <select
            value={value}
            onChange={(e) => updateProviderConfig(providerId, field.key, e.target.value)}
            className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 text-sm"
          >
            <option value="">Select a model</option>
            {cloudModels.map((model) => (
              <option key={model.name} value={model.name}>
                {model.name}
              </option>
            ))}
          </select>
        )
      }
      // Fall through to text input if no models
    }

    // Special handling for Ollama model field with dynamic model list
    if (providerId === 'ollama' && field.key === 'model') {
      if (isLoadingModels) {
        return <div className="text-text-muted text-sm py-2">Loading models...</div>
      }
      if (ollamaModels.length > 0) {
        return (
          <select
            value={value}
            onChange={(e) => updateProviderConfig(providerId, field.key, e.target.value)}
            className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 text-sm"
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
          className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 text-sm"
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
        className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
      />
    )
  }

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'ai', label: 'AI' },
    { id: 'cloud', label: 'Cloud' },
    { id: 'security', label: 'Security' },
  ]

  const currentProvider = PROVIDERS.find((p) => p.id === aiProvider)

  return (
    <div className="fixed inset-0 bg-bg-overlay flex items-center justify-center z-50 p-4">
      {/* Telemetry guilt trip interstitial */}
      {telemetryGuiltTrip && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-bg-surface rounded-lg w-full max-w-sm border border-border-default p-6 space-y-4 text-center">
            <div className="text-4xl leading-none">
              {telemetryGuiltTrip.isMilton ? (
                <span className="font-mono tracking-tighter">-_-</span>
              ) : (
                <span>&#9749;</span>
              )}
            </div>
            <p className="text-sm text-text-secondary italic leading-relaxed">
              &ldquo;{telemetryGuiltTrip.quote}&rdquo;
            </p>
            <p className="text-xs text-text-muted">&mdash; {telemetryGuiltTrip.speaker}</p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  setTelemetryConsent(false)
                  setTelemetryGuiltTrip(null)
                }}
                className="px-4 py-2 text-text-tertiary hover:text-text-primary transition-colors text-sm"
              >
                Turn it off anyway
              </button>
              <button
                type="button"
                onClick={() => setTelemetryGuiltTrip(null)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors text-sm"
              >
                Fine, keep it on
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-bg-surface rounded-lg w-full max-w-lg border border-border-default">
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-lg font-semibold text-text-primary">Settings</h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-border-default">
          {tabs.map((tab) => (
            <button
              key={tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`px-4 py-2 text-sm font-medium transition-colors ${
                activeTab === tab.id
                  ? 'text-blue-400 border-b-2 border-blue-400'
                  : 'text-text-tertiary hover:text-text-primary'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>

        {isLoading ? (
          <div className="p-8 text-center text-text-tertiary">Loading settings...</div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-4 max-h-[60vh] overflow-y-auto">
            {/* General Tab */}
            {activeTab === 'general' && (
              <div className="space-y-4">
                <div>
                  <label className="block text-sm text-text-tertiary mb-1">
                    Repository Search Directory
                  </label>
                  <input
                    type="text"
                    value={repoSearchDir}
                    onChange={(e) => setRepoSearchDir(e.target.value)}
                    placeholder="e.g., ~/src or /home/user/projects"
                    className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Directory to search for git repositories
                  </p>
                </div>
                <div>
                  <label className="block text-sm text-text-tertiary mb-1">Git Graph Commits</label>
                  <input
                    type="number"
                    min={10}
                    max={1000}
                    step={10}
                    value={gitGraphCommits}
                    onChange={(e) => setGitGraphCommits(e.target.value)}
                    className="w-32 px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
                  />
                  <p className="text-xs text-text-muted mt-1">
                    Number of commits to show in the git graph (10-1000)
                  </p>
                </div>
                {Object.keys(agentProviders).length > 1 && (
                  <div>
                    <label className="block text-sm text-text-tertiary mb-1">Default Agent</label>
                    <select
                      value={defaultAgent}
                      onChange={(e) => setDefaultAgent(e.target.value)}
                      className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 text-sm"
                    >
                      {Object.entries(agentProviders).map(([key, provider]) => (
                        <option key={key} value={key}>
                          {provider.label}
                        </option>
                      ))}
                    </select>
                    <p className="text-xs text-text-muted mt-1">
                      Agent used for new sessions by default
                    </p>
                  </div>
                )}
                <div>
                  <label className="block text-sm text-text-tertiary mb-2">
                    Default Tab Visibility
                  </label>
                  <div className="flex flex-wrap gap-3">
                    {(
                      [
                        ['git', 'Git'],
                        ['files', 'Files'],
                        ['todos', 'Todos'],
                        ['prompts', 'Prompts'],
                        ['shared', 'Shared'],
                      ] as const
                    ).map(([key, label]) => {
                      const isEnabled = tabVisibility[key] !== false
                      const enabledCount = Object.values(tabVisibility).filter(Boolean).length
                      const isLastEnabled = isEnabled && enabledCount <= 1
                      return (
                        <label
                          key={key}
                          className={`flex items-center gap-1.5 text-sm ${isLastEnabled ? 'opacity-50' : ''}`}
                        >
                          <input
                            type="checkbox"
                            checked={isEnabled}
                            disabled={isLastEnabled}
                            onChange={() =>
                              setTabVisibility((prev) => ({ ...prev, [key]: !prev[key] }))
                            }
                            className="rounded border-input-border bg-input-bg"
                          />
                          <span className="text-text-secondary">{label}</span>
                        </label>
                      )
                    })}
                  </div>
                  <p className="text-xs text-text-muted mt-1">
                    Tabs shown in the session detail view by default
                  </p>
                </div>
                <div className="flex items-center justify-between">
                  <div>
                    <label className="block text-sm text-text-tertiary">
                      Anonymous Usage Statistics
                    </label>
                    <p className="text-xs text-text-muted mt-0.5">
                      Help improve Lumbergh by sending anonymous usage data.{' '}
                      <a
                        href="https://lumbergh.jc.turbo.inc/privacy"
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-blue-400 hover:text-blue-300"
                      >
                        What we collect
                      </a>
                    </p>
                  </div>
                  <button
                    type="button"
                    role="switch"
                    aria-checked={telemetryConsent}
                    onClick={() => {
                      if (telemetryConsent) {
                        // Trying to turn off — show guilt trip interstitial
                        const quotes = [
                          {
                            quote:
                              'Yeahhh... if you could go ahead and keep those analytics on, that would be greaaaat. Mmmkay?',
                            speaker: 'Bill Lumbergh',
                            isMilton: false,
                          },
                          {
                            quote:
                              'I... I was told there would be analytics. I could set the building on fire...',
                            speaker: 'Milton Waddams',
                            isMilton: true,
                          },
                          {
                            quote:
                              "Without analytics we can't file our TPS reports. And you remember what happened last time.",
                            speaker: 'Bill Lumbergh',
                            isMilton: false,
                          },
                          {
                            quote:
                              'First they took my stapler. Then they took my analytics. I... I could...',
                            speaker: 'Milton Waddams',
                            isMilton: true,
                          },
                          {
                            quote:
                              "I'm gonna need you to go ahead and come in on Saturday... and turn those analytics back on.",
                            speaker: 'Bill Lumbergh',
                            isMilton: false,
                          },
                          {
                            quote:
                              'We need at least 15 pieces of flair. Analytics is one of them. Do you really want to be a bare minimum person?',
                            speaker: "Stan, Chotchkie's",
                            isMilton: false,
                          },
                          {
                            quote:
                              "Oh, and remember: Friday is Hawaiian shirt day. But without analytics, we won't know if anyone showed up.",
                            speaker: 'Bill Lumbergh',
                            isMilton: false,
                          },
                          {
                            quote:
                              "Excuse me... I believe you have my analytics. And if you don't give them back, I'm going to have to... I'll...",
                            speaker: 'Milton Waddams',
                            isMilton: true,
                          },
                        ]
                        setTelemetryGuiltTrip(quotes[Math.floor(Math.random() * quotes.length)])
                      } else {
                        setTelemetryConsent(true)
                      }
                    }}
                    className={`relative inline-flex h-6 w-11 shrink-0 rounded-full transition-colors ${
                      telemetryConsent ? 'bg-blue-600' : 'bg-control-bg-hover'
                    }`}
                  >
                    <span
                      className={`inline-block h-5 w-5 transform rounded-full bg-white shadow transition-transform mt-0.5 ${
                        telemetryConsent ? 'translate-x-5.5' : 'translate-x-0.5'
                      }`}
                    />
                  </button>
                </div>
              </div>
            )}

            {/* AI Tab */}
            {activeTab === 'ai' && (
              <div className="space-y-4">
                {/* Provider selector */}
                <div>
                  <label className="block text-sm text-text-tertiary mb-1">AI Provider</label>
                  <select
                    value={aiProvider}
                    onChange={(e) => setAiProvider(e.target.value)}
                    className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 text-sm"
                  >
                    {PROVIDERS.filter((p) => p.id !== 'lumbergh_cloud' || cloudUsername).map(
                      (p) => (
                        <option key={p.id} value={p.id}>
                          {p.label}
                        </option>
                      )
                    )}
                  </select>
                </div>

                {/* Provider-specific fields (data-driven) */}
                {currentProvider && (
                  <div className="space-y-3 p-3 bg-bg-elevated/50 rounded">
                    {currentProvider.fields.map((field) => (
                      <div key={field.key}>
                        <label className="block text-sm text-text-tertiary mb-1">
                          {field.label}
                        </label>
                        {renderField(currentProvider.id, field)}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Cloud Tab */}
            {activeTab === 'cloud' && <CloudSettings onConnected={fetchSettings} />}

            {/* Security Tab */}
            {activeTab === 'security' && (
              <SecuritySettings
                password={password}
                onPasswordChange={(value) => {
                  setPassword(value)
                  setPasswordChanged(true)
                }}
                passwordSet={passwordSet}
                passwordSource={passwordSource}
                restartNeeded={restartNeeded}
              />
            )}

            {error && <div className="text-red-400 text-sm">{error}</div>}

            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={onClose}
                className="px-4 py-2 text-text-tertiary hover:text-text-primary transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-control-bg-hover disabled:cursor-not-allowed text-white rounded transition-colors"
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
