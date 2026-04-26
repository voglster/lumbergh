import { useState, useEffect, useCallback } from 'react'
import { X } from 'lucide-react'
import CloudSettings from './CloudSettings'
import SecuritySettings from './SecuritySettings'
import GeneralSettings from './GeneralSettings'
import AISettingsTab from './AISettingsTab'
import { getDefaultProviderConfigs, type AIProviderConfig } from './aiProviders'
import { getApiBase } from '../config'

interface Props {
  onClose: () => void
}

interface AISettingsData {
  provider: string
  providers: Record<string, AIProviderConfig>
}

interface Settings {
  repoSearchDir: string
  gitGraphCommits: number
  ai: AISettingsData
  defaultAgent?: string
  agentProviders?: Record<string, { label: string }>
  passwordSet?: boolean
  passwordSource?: string | null
  telemetryConsent?: boolean | null
  cloudUsername?: string
  tabVisibility?: Record<string, boolean>
  showSessionDots?: boolean
  scratchMaxAgeDays?: number
}

type TabId = 'general' | 'ai' | 'cloud' | 'security'

export default function SettingsModal({ onClose }: Props) {
  const [activeTab, setActiveTab] = useState<TabId>('general')
  const [repoSearchDir, setRepoSearchDir] = useState('')
  const [gitGraphCommits, setGitGraphCommits] = useState('100')
  const [aiProvider, setAiProvider] = useState('ollama')
  const [providerConfigs, setProviderConfigs] =
    useState<Record<string, AIProviderConfig>>(getDefaultProviderConfigs)
  const [telemetryConsent, setTelemetryConsent] = useState(false)
  const [password, setPassword] = useState('')
  const [passwordSet, setPasswordSet] = useState(false)
  const [passwordSource, setPasswordSource] = useState<string | null>(null)
  const [passwordChanged, setPasswordChanged] = useState(false)
  const [defaultAgent, setDefaultAgent] = useState('claude-code')
  const [agentProviders, setAgentProviders] = useState<Record<string, { label: string }>>({})
  const [tabVisibility, setTabVisibility] = useState<Record<string, boolean>>({
    git: true,
    files: true,
    todos: true,
    prompts: true,
    shared: true,
  })
  const [showSessionDots, setShowSessionDots] = useState(true)
  const [scratchMaxAgeDays, setScratchMaxAgeDays] = useState('7')
  const [cloudUsername, setCloudUsername] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)
  const [restartNeeded, setRestartNeeded] = useState(false)

  const applyAiSettings = useCallback((ai: AISettingsData) => {
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
      setPasswordSet(!!data.passwordSet)
      setPasswordSource(data.passwordSource ?? null)
      setTelemetryConsent(!!data.telemetryConsent)
      setCloudUsername(data.cloudUsername ?? null)
      if (data.defaultAgent) setDefaultAgent(data.defaultAgent)
      if (data.agentProviders) setAgentProviders(data.agentProviders)
      if (data.tabVisibility) setTabVisibility(data.tabVisibility)
      if (data.showSessionDots != null) setShowSessionDots(data.showSessionDots)
      if (data.scratchMaxAgeDays != null) setScratchMaxAgeDays(String(data.scratchMaxAgeDays))
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
      payload.showSessionDots = showSessionDots
      payload.scratchMaxAgeDays = Math.max(0, parseInt(scratchMaxAgeDays) || 7)
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

  const tabs: { id: TabId; label: string }[] = [
    { id: 'general', label: 'General' },
    { id: 'ai', label: 'AI' },
    { id: 'cloud', label: 'Cloud' },
    { id: 'security', label: 'Security' },
  ]

  return (
    <div className="fixed inset-0 bg-bg-overlay flex items-center justify-center z-50 p-4">
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
            {activeTab === 'general' && (
              <GeneralSettings
                repoSearchDir={repoSearchDir}
                onRepoSearchDirChange={setRepoSearchDir}
                gitGraphCommits={gitGraphCommits}
                onGitGraphCommitsChange={setGitGraphCommits}
                defaultAgent={defaultAgent}
                onDefaultAgentChange={setDefaultAgent}
                agentProviders={agentProviders}
                tabVisibility={tabVisibility}
                onTabVisibilityChange={setTabVisibility}
                showSessionDots={showSessionDots}
                onShowSessionDotsChange={setShowSessionDots}
                scratchMaxAgeDays={scratchMaxAgeDays}
                onScratchMaxAgeDaysChange={setScratchMaxAgeDays}
                telemetryConsent={telemetryConsent}
                onTelemetryConsentChange={setTelemetryConsent}
              />
            )}

            {activeTab === 'ai' && (
              <AISettingsTab
                aiProvider={aiProvider}
                onAiProviderChange={setAiProvider}
                providerConfigs={providerConfigs}
                onProviderConfigChange={updateProviderConfig}
                cloudUsername={cloudUsername}
              />
            )}

            {activeTab === 'cloud' && <CloudSettings onConnected={fetchSettings} />}

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
