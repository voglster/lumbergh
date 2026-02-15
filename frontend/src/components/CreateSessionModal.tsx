import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DirectoryPicker from './DirectoryPicker'

interface Props {
  apiHost: string
  onClose: () => void
  onCreated: () => void
}

// Generate a URL-safe slug from free-form text
function toSlug(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s_-]/g, '') // Remove invalid characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Collapse multiple hyphens
    .replace(/^-|-$/g, '') // Trim leading/trailing hyphens
}

export default function CreateSessionModal({ apiHost, onClose, onCreated }: Props) {
  const navigate = useNavigate()
  const [name, setName] = useState('')
  const [workdir, setWorkdir] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [manualEntry, setManualEntry] = useState(false)

  const slug = toSlug(name)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!slug || !workdir.trim()) return

    setIsCreating(true)
    setError(null)

    try {
      const res = await fetch(`http://${apiHost}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: slug,
          workdir: workdir.trim(),
          description: description.trim(),
        }),
      })

      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to create session')
      }

      const data = await res.json()
      if (data.existing) {
        // Session already exists for this repo - navigate to it
        navigate(`/session/${data.name}`)
        onClose()
        return
      }

      onCreated()
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create session')
    } finally {
      setIsCreating(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-gray-800 rounded-lg w-full max-w-md border border-gray-700">
        <div className="flex items-center justify-between p-4 border-b border-gray-700">
          <h2 className="text-lg font-semibold text-white">New Session</h2>
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

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          <div>
            <label className="block text-sm text-gray-400 mb-1">Session Name</label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g., Auth Feature, fix-login-bug"
              className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500"
              required
            />
            {slug && (
              <p className="text-xs text-gray-500 mt-1">
                Session ID: <span className="text-gray-400 font-mono">{slug}</span>
              </p>
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Working Directory</label>
            {manualEntry ? (
              <div>
                <input
                  type="text"
                  value={workdir}
                  onChange={(e) => setWorkdir(e.target.value)}
                  placeholder="e.g., /home/user/myproject"
                  className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500 font-mono text-sm"
                  required
                />
                <button
                  type="button"
                  onClick={() => {
                    setManualEntry(false)
                    setWorkdir('')
                  }}
                  className="mt-2 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                >
                  Search repositories instead
                </button>
              </div>
            ) : (
              <DirectoryPicker
                apiHost={apiHost}
                value={workdir}
                onChange={setWorkdir}
                onManualEntry={() => setManualEntry(true)}
              />
            )}
          </div>

          <div>
            <label className="block text-sm text-gray-400 mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Working on user authentication"
              className="w-full px-3 py-2 bg-gray-700 text-white rounded border border-gray-600 focus:outline-none focus:border-blue-500"
            />
          </div>

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
              disabled={isCreating || !slug || !workdir.trim()}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded transition-colors"
            >
              {isCreating ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
