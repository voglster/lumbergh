import { Bot } from 'lucide-react'

interface Props {
  agentProviders: Record<string, { label: string }>
  agentProvider: string
  defaultAgent: string
  onAgentProviderChange: (value: string) => void
}

export default function AgentProviderSelect({
  agentProviders,
  agentProvider,
  defaultAgent,
  onAgentProviderChange,
}: Props) {
  if (Object.keys(agentProviders).length <= 1) return null

  return (
    <div>
      <label className="block text-sm text-text-tertiary mb-1">
        <Bot size={14} className="inline mr-1 -mt-0.5" />
        Agent
      </label>
      <select
        value={agentProvider || defaultAgent}
        onChange={(e) => onAgentProviderChange(e.target.value)}
        className="w-full px-3 py-2 bg-input-bg text-text-primary rounded-[var(--radius-lg)] border border-input-border focus:outline-none focus:border-action/50"
      >
        {Object.entries(agentProviders).map(([key, provider]) => (
          <option key={key} value={key}>
            {provider.label}
            {key === defaultAgent ? ' (default)' : ''}
          </option>
        ))}
      </select>
    </div>
  )
}
