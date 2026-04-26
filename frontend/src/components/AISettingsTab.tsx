import { useState, useEffect, useCallback } from 'react'
import { getApiBase } from '../config'
import { PROVIDERS, type AIProviderConfig } from './aiProviders'

interface Props {
  aiProvider: string
  onAiProviderChange: (value: string) => void
  providerConfigs: Record<string, AIProviderConfig>
  onProviderConfigChange: (providerId: string, key: string, value: string) => void
  cloudUsername: string | null
}

interface OllamaModel {
  name: string
  size: number
  parameter_size: string
}

interface CloudModel {
  name: string
}

function formatSize(bytes: number) {
  const gb = bytes / (1024 * 1024 * 1024)
  return `${gb.toFixed(1)} GB`
}

export default function AISettingsTab({
  aiProvider,
  onAiProviderChange,
  providerConfigs,
  onProviderConfigChange,
  cloudUsername,
}: Props) {
  const [ollamaModels, setOllamaModels] = useState<OllamaModel[]>([])
  const [cloudModels, setCloudModels] = useState<CloudModel[]>([])
  const [isLoadingModels, setIsLoadingModels] = useState(false)

  const fetchOllamaModels = useCallback(async () => {
    setIsLoadingModels(true)
    try {
      const res = await fetch(`${getApiBase()}/ai/ollama/models`)
      if (res.ok) setOllamaModels(await res.json())
    } catch {
      // Ollama might not be running
    } finally {
      setIsLoadingModels(false)
    }
  }, [])

  const fetchCloudModels = useCallback(async () => {
    try {
      const res = await fetch(`${getApiBase()}/ai/cloud/models`)
      if (res.ok) setCloudModels(await res.json())
    } catch {
      // Cloud might not be connected
    }
  }, [])

  useEffect(() => {
    fetchOllamaModels()
    if (cloudUsername) fetchCloudModels()
  }, [fetchOllamaModels, fetchCloudModels, cloudUsername])

  const currentProvider = PROVIDERS.find((p) => p.id === aiProvider)

  const renderField = (providerId: string, field: (typeof PROVIDERS)[number]['fields'][number]) => {
    const config = providerConfigs[providerId]
    const value = config?.[field.key] || ''

    if (providerId === 'lumbergh_cloud' && field.key === 'model' && cloudModels.length > 0) {
      return (
        <select
          value={value}
          onChange={(e) => onProviderConfigChange(providerId, field.key, e.target.value)}
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

    if (providerId === 'ollama' && field.key === 'model') {
      if (isLoadingModels) {
        return <div className="text-text-muted text-sm py-2">Loading models...</div>
      }
      if (ollamaModels.length > 0) {
        return (
          <select
            value={value}
            onChange={(e) => onProviderConfigChange(providerId, field.key, e.target.value)}
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
    }

    if (field.type === 'select' && field.options) {
      return (
        <select
          value={value}
          onChange={(e) => onProviderConfigChange(providerId, field.key, e.target.value)}
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
        onChange={(e) => onProviderConfigChange(providerId, field.key, e.target.value)}
        placeholder={field.placeholder}
        className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
      />
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-text-tertiary mb-1">AI Provider</label>
        <select
          value={aiProvider}
          onChange={(e) => onAiProviderChange(e.target.value)}
          className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 text-sm"
        >
          {PROVIDERS.filter((p) => p.id !== 'lumbergh_cloud' || cloudUsername).map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
      </div>

      {currentProvider && (
        <div className="space-y-3 p-3 bg-bg-elevated/50 rounded">
          {currentProvider.fields.map((field) => (
            <div key={field.key}>
              <label className="block text-sm text-text-tertiary mb-1">{field.label}</label>
              {renderField(currentProvider.id, field)}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
