export interface AIProviderConfig {
  baseUrl?: string
  apiKey?: string
  model?: string
}

interface FieldDef {
  key: 'baseUrl' | 'apiKey' | 'model'
  label: string
  type: 'text' | 'password' | 'select'
  placeholder?: string
  options?: { value: string; label: string }[]
}

export interface ProviderDef {
  id: string
  label: string
  fields: FieldDef[]
  defaultModel: string
}

export const PROVIDERS: ProviderDef[] = [
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
      {
        key: 'apiKey',
        label: 'API Key (optional)',
        type: 'password',
        placeholder: 'your-api-key',
      },
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

export function getDefaultProviderConfigs(): Record<string, AIProviderConfig> {
  const initial: Record<string, AIProviderConfig> = {}
  PROVIDERS.forEach((p) => {
    initial[p.id] = {
      baseUrl: p.id === 'ollama' ? 'http://localhost:11434' : '',
      apiKey: '',
      model: p.defaultModel,
    }
  })
  return initial
}
