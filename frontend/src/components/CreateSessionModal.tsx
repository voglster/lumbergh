import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { X } from 'lucide-react'
import { getApiBase } from '../config'
import DirectoryPicker from './DirectoryPicker'
import BranchPicker from './BranchPicker'

interface Props {
  onClose: () => void
  onCreated: () => void
}

type SessionMode = 'existing' | 'new' | 'worktree'
type DirStatus = 'unchecked' | 'checking' | 'exists' | 'not_found' | 'error'

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

export default function CreateSessionModal({ onClose, onCreated }: Props) {
  const navigate = useNavigate()
  const [mode, setMode] = useState<SessionMode>('existing')
  const [name, setName] = useState('')
  const [workdir, setWorkdir] = useState('')
  const [description, setDescription] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [isCreating, setIsCreating] = useState(false)
  const [manualEntry, setManualEntry] = useState(false)

  const [dirStatus, setDirStatus] = useState<DirStatus>('unchecked')

  // New repo mode state
  const [projectName, setProjectName] = useState('')
  const [parentDir, setParentDir] = useState('')
  const [editingParentDir, setEditingParentDir] = useState(false)

  // Worktree mode state
  const [parentRepo, setParentRepo] = useState('')
  const [branch, setBranch] = useState('')
  const [createNewBranch, setCreateNewBranch] = useState(false)
  const [newBranchName, setNewBranchName] = useState('')

  // Fetch repoSearchDir for default parent directory
  useEffect(() => {
    fetch(`${getApiBase()}/settings`)
      .then((res) => res.json())
      .then((data) => {
        if (data.repoSearchDir) setParentDir(data.repoSearchDir)
      })
      .catch(() => {})
  }, [])

  const projectSlug = toSlug(projectName)
  const newRepoPath = parentDir && projectSlug ? `${parentDir}/${projectSlug}` : ''

  const slug =
    toSlug(name) ||
    (mode === 'existing'
      ? toSlug(workdir.split('/').filter(Boolean).pop() || '')
      : mode === 'new'
        ? projectSlug
        : toSlug(parentRepo.split('/').filter(Boolean).pop() || ''))

  // Debounced directory validation for manual entry
  useEffect(() => {
    if (!manualEntry || !workdir.trim() || mode !== 'existing') {
      setDirStatus('unchecked')
      return
    }
    setDirStatus('checking')
    const timer = setTimeout(async () => {
      try {
        const res = await fetch(
          `${getApiBase()}/directories/validate?path=${encodeURIComponent(workdir.trim())}`
        )
        const data = await res.json()
        setDirStatus(data.exists ? 'exists' : 'not_found')
      } catch {
        setDirStatus('error')
      }
    }, 400)
    return () => clearTimeout(timer)
  }, [workdir, manualEntry, mode])

  const isValid = () => {
    if (!slug) return false
    if (mode === 'existing') {
      if (!workdir.trim()) return false
      if (manualEntry && dirStatus === 'not_found') return false
      if (manualEntry && dirStatus === 'checking') return false
      return true
    } else if (mode === 'new') {
      return projectSlug !== '' && parentDir.trim() !== ''
    } else {
      return (
        parentRepo.trim() !== '' && (createNewBranch ? newBranchName.trim() !== '' : branch !== '')
      )
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
      }

      if (mode === 'existing') {
        body.mode = 'direct'
        body.workdir = workdir.trim()
      } else if (mode === 'new') {
        body.mode = 'direct'
        body.workdir = newRepoPath
        body.init_repo = true
      } else {
        body.mode = 'worktree'
        body.worktree = {
          parent_repo: parentRepo.trim(),
          branch: createNewBranch ? newBranchName.trim() : branch,
          create_branch: createNewBranch,
        }
      }

      const res = await fetch(`${getApiBase()}/sessions`, {
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
    <div className="fixed inset-0 bg-bg-overlay flex items-center justify-center z-50 p-4">
      <div
        className="bg-bg-surface rounded-lg w-full max-w-md border border-border-default"
        data-testid="create-session-modal"
      >
        <div className="flex items-center justify-between p-4 border-b border-border-default">
          <h2 className="text-lg font-semibold text-text-primary">New Session</h2>
          <button
            onClick={onClose}
            className="text-text-tertiary hover:text-text-primary transition-colors"
          >
            <X size={20} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-4 space-y-4">
          {/* Mode Toggle */}
          <div>
            <label className="block text-sm text-text-tertiary mb-2">Session Type</label>
            <div className="flex gap-2">
              {(
                [
                  { key: 'existing', label: 'Existing Repo', desc: 'Use existing directory' },
                  { key: 'new', label: 'New Repo', desc: 'Create new git repo' },
                  { key: 'worktree', label: 'Worktree', desc: 'Create git worktree' },
                ] as const
              ).map((opt) => (
                <button
                  key={opt.key}
                  type="button"
                  onClick={() => setMode(opt.key)}
                  className={`flex-1 px-3 py-2 text-sm rounded transition-colors ${
                    mode === opt.key
                      ? 'bg-blue-600 text-white'
                      : 'bg-control-bg text-text-tertiary hover:text-text-primary hover:bg-control-bg-hover'
                  }`}
                >
                  <div className="font-medium">{opt.label}</div>
                  <div className="text-xs opacity-75 mt-0.5">{opt.desc}</div>
                </button>
              ))}
            </div>
          </div>

          {mode !== 'new' && (
            /* Session Name - not shown for New Repo (project name drives it) */
            <div>
              <label className="block text-sm text-text-tertiary mb-1">
                Session Name <span className="text-text-muted font-normal">(optional)</span>
              </label>
              <input
                type="text"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder={
                  workdir
                    ? workdir.split('/').filter(Boolean).pop() || 'auto'
                    : 'auto from directory'
                }
                data-testid="session-name-input"
                className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500"
              />
              {slug && (
                <p className="text-xs text-text-muted mt-1">
                  Session ID: <span className="text-text-tertiary font-mono">{slug}</span>
                </p>
              )}
            </div>
          )}

          {mode === 'existing' ? (
            /* Existing Repo Mode - Working Directory */
            <div>
              <label className="block text-sm text-text-tertiary mb-1">Working Directory</label>
              {manualEntry ? (
                <div>
                  <input
                    type="text"
                    value={workdir}
                    onChange={(e) => setWorkdir(e.target.value)}
                    placeholder="e.g., /home/user/myproject"
                    data-testid="workdir-input"
                    className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
                    required
                  />
                  {dirStatus === 'checking' && (
                    <p className="text-xs text-text-muted mt-1">Checking...</p>
                  )}
                  {dirStatus === 'exists' && (
                    <p className="text-xs text-green-400 mt-1">Directory exists</p>
                  )}
                  {dirStatus === 'not_found' && (
                    <p className="text-xs text-yellow-400 mt-1">
                      Directory not found — use the &quot;New Repo&quot; tab to create one
                    </p>
                  )}
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
                  value={workdir}
                  onChange={setWorkdir}
                  onManualEntry={() => setManualEntry(true)}
                />
              )}
            </div>
          ) : mode === 'new' ? (
            /* New Repo Mode */
            <>
              <div>
                <label className="block text-sm text-text-tertiary mb-1">Project Name</label>
                <input
                  type="text"
                  value={projectName}
                  onChange={(e) => setProjectName(e.target.value)}
                  placeholder="e.g., my-new-project"
                  data-testid="project-name-input"
                  className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500"
                  autoFocus
                />
                {projectSlug && projectSlug !== projectName && (
                  <p className="text-xs text-text-muted mt-1">
                    Directory name:{' '}
                    <span className="text-text-tertiary font-mono">{projectSlug}</span>
                  </p>
                )}
              </div>
              <div>
                <label className="block text-sm text-text-tertiary mb-1">Parent Directory</label>
                {editingParentDir ? (
                  <div>
                    <input
                      type="text"
                      value={parentDir}
                      onChange={(e) => setParentDir(e.target.value)}
                      placeholder="e.g., /home/user/src"
                      className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
                    />
                    <button
                      type="button"
                      onClick={() => setEditingParentDir(false)}
                      className="mt-1 text-xs text-blue-400 hover:text-blue-300 transition-colors"
                    >
                      Done
                    </button>
                  </div>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-text-primary font-mono truncate">
                      {parentDir || '(not set)'}
                    </span>
                    <button
                      type="button"
                      onClick={() => setEditingParentDir(true)}
                      className="text-xs text-blue-400 hover:text-blue-300 transition-colors shrink-0"
                    >
                      Change
                    </button>
                  </div>
                )}
              </div>
              {newRepoPath && (
                <div className="px-3 py-2 bg-control-bg rounded border border-border-default">
                  <p className="text-xs text-text-muted mb-0.5">Will create:</p>
                  <p className="text-sm text-text-primary font-mono break-all">{newRepoPath}</p>
                </div>
              )}
              {slug && (
                <p className="text-xs text-text-muted">
                  Session ID: <span className="text-text-tertiary font-mono">{slug}</span>
                </p>
              )}
            </>
          ) : (
            /* Worktree Mode */
            <>
              <div>
                <label className="block text-sm text-text-tertiary mb-1">Parent Repository</label>
                <DirectoryPicker
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
                  <label className="block text-sm text-text-tertiary mb-1">Branch</label>
                  <BranchPicker
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
            <label className="block text-sm text-text-tertiary mb-1">Description (optional)</label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="e.g., Working on user authentication"
              className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500"
            />
          </div>

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
              disabled={isCreating || !isValid()}
              data-testid="create-session-submit"
              className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-control-bg-hover disabled:cursor-not-allowed text-white rounded transition-colors"
            >
              {isCreating ? 'Creating...' : 'Create Session'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}
