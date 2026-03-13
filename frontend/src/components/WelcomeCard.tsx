import { useState } from 'react'
import { FolderOpen, Settings } from 'lucide-react'
import { getApiBase } from '../config'

interface Props {
  defaultRepoDir: string
  onComplete: () => void
  onOpenSettings: () => void
}

export default function WelcomeCard({ defaultRepoDir, onComplete, onOpenSettings }: Props) {
  const [repoDir, setRepoDir] = useState(defaultRepoDir)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleCreateSession = async () => {
    setSaving(true)
    setError(null)
    try {
      const res = await fetch(`${getApiBase()}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ repoSearchDir: repoDir }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to save settings')
      }
      onComplete()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-col items-center justify-center py-12">
      <div className="w-full max-w-md bg-bg-surface border border-border-default rounded-lg p-6">
        <h2 className="text-lg font-semibold text-text-primary mb-1">Welcome to Lumbergh</h2>
        <p className="text-sm text-text-tertiary mb-6">
          Supervise your Claude Code sessions from one dashboard.
        </p>

        {/* Step 1: Repo search directory */}
        <div className="mb-6">
          <label className="flex items-center gap-2 text-sm font-medium text-text-secondary mb-2">
            <FolderOpen size={16} />
            Repo search directory
          </label>
          <input
            type="text"
            value={repoDir}
            onChange={(e) => setRepoDir(e.target.value)}
            className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
          />
          <p className="text-xs text-text-muted mt-1">
            Lumbergh will search this directory for git repositories when creating sessions.
          </p>
        </div>

        {error && <p className="text-sm text-red-400 mb-4">{error}</p>}

        {/* Step 2: Create session */}
        <button
          onClick={handleCreateSession}
          disabled={saving || !repoDir.trim()}
          className="w-full py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-blue-800 disabled:text-text-muted rounded font-medium transition-colors mb-3"
        >
          {saving ? 'Saving...' : 'Create Your First Session'}
        </button>

        <button
          onClick={onOpenSettings}
          className="w-full flex items-center justify-center gap-2 py-2 text-sm text-text-tertiary hover:text-text-primary transition-colors"
        >
          <Settings size={14} />
          Open full settings
        </button>
      </div>
    </div>
  )
}
