import { useState, useEffect } from 'react'

interface Props {
  apiHost: string
  onClose: () => void
}

interface Settings {
  repoSearchDir: string
}

export default function SettingsModal({ apiHost, onClose }: Props) {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [repoSearchDir, setRepoSearchDir] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [isLoading, setIsLoading] = useState(true)

  useEffect(() => {
    const fetchSettings = async () => {
      try {
        const res = await fetch(`http://${apiHost}/api/settings`)
        if (!res.ok) throw new Error('Failed to fetch settings')
        const data = await res.json()
        setSettings(data)
        setRepoSearchDir(data.repoSearchDir || '')
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to load settings')
      } finally {
        setIsLoading(false)
      }
    }
    fetchSettings()
  }, [apiHost])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!repoSearchDir.trim()) return

    setIsSaving(true)
    setError(null)

    try {
      const res = await fetch(`http://${apiHost}/api/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          repoSearchDir: repoSearchDir.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to save settings')
      }

      const data = await res.json()
      setSettings(data)
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings')
    } finally {
      setIsSaving(false)
    }
  }

  const hasChanges = settings && repoSearchDir !== settings.repoSearchDir

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-md border border-gray-700">
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

        {isLoading ? (
          <div className="p-8 text-center text-gray-400">
            Loading settings...
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="p-4 space-y-4">
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
                required
              />
              <p className="text-xs text-gray-500 mt-1">
                Directory to search for git repositories when creating new sessions
              </p>
            </div>

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
                disabled={isSaving || !repoSearchDir.trim() || !hasChanges}
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
