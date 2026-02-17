import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import DirectoryPicker from './DirectoryPicker'
import BranchPicker from './BranchPicker'

interface Props {
  apiHost: string
  onClose: () => void
  onCreated: () => void
}

type SessionMode = 'direct' | 'worktree'

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
  const [mode, setMode] = useState<SessionMode>('direct')
  const [name, setName] = useState('')
  const [workdir, setWorkdir] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [manualEntry, setManualEntry] = useState(false)

  // Worktree mode state
  const [parentRepo, setParentRepo] = useState('')
  const [branch, setBranch] = useState('')
  const [createNewBranch, setCreateNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')

  const slug = toSlug(name)

  const isValid = () => {
    if (!slug) return false
    if (mode === 'direct') {
      return workdir.trim() !== ''
    } else {
      return parentRepo.trim() !== '' && (createNewBranch ? newBranchName.trim() !== '' : branch !== '')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!isValid()) return

    setIsCreating(true)
    setError(null)

    try {
      const body: Record<string, unknown> = {
        name: slug,
        description: description.trim(),
        mode,
      }

      if (mode === 'direct') {
        body.workdir = workdir.trim()
      } else {
        body.worktree = {
          parent_repo: parentRepo.trim(),
          branch: createNewBranch ? newBranchName.trim() : branch,
          create_branch: createNewBranch,
        }
      }

      const res = await fetch(`http://${apiHost}/api/sessions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
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
          {/* Mode Toggle */}
          <div>
            <label className="block text-sm text-gray-400 mb-2">Session Type</label>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setMode('direct')}
                className={`flex-1 px-3 py-2 text-sm rounded transition-colors ${
                  mode === 'direct'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
                }`}
              >
                <div className="font-medium">Direct</div>
                <div className="text-xs opacity-75 mt-0.5">Use existing directory</div>
              </button>
              <button
                type="button"
                onClick={() => setMode('worktree')}
                className={`flex-1 px-3 py-2 text-sm rounded transition-colors ${
                  mode === 'worktree'
                    ? 'bg-blue-600 text-white'
                    : 'bg-gray-700 text-gray-400 hover:text-white hover:bg-gray-600'
                }`}
              >
                <div className="font-medium">Worktree</div>
                <div className="text-xs opacity-75 mt-0.5">Create git worktree</div>
              </button>
            </div>
          </div>

          {/* Session Name */}
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

          {mode === 'direct' ? (
            /* Direct Mode - Working Directory */
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
          ) : (
            /* Worktree Mode */
            <>
              <div>
                <label className="block text-sm text-gray-400 mb-1">Parent Repository</label>
                <DirectoryPicker
                  apiHost={apiHost}
                  value={parentRepo}
                  onChange={(path) => {
                    setParentRepo(path)
                    setBranch('')
                  }}
                  onManualEntry={() => {}}
                />
              </div>

              {parentRepo && (
                <div>
                  <label className="block text-sm text-gray-400 mb-1">Branch</label>
                  <BranchPicker
                    apiHost={apiHost}
                    repoPath={parentRepo}
                    value={branch}
                    onChange={setBranch}
                    onCreateNew={setNewBranchName}
                    createNewBranch={createNewBranch}
                    onCreateNewBranchChange={setCreateNewBranch}
                  />
                </div>
              )}
            </>
          )}

          {/* Description */}
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
              disabled={isCreating || !isValid()}
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
