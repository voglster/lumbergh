import { useState, useEffect } from 'react'

interface Branch {
  name: string
  available: boolean
  inWorktree: boolean
  current: boolean
}

interface Props {
  apiHost: string
  repoPath: string
  value: string
  onChange: (branch: string) => void
  onCreateNew: (branch: string) => void
  createNewBranch: boolean
  onCreateNewBranchChange: (createNew: boolean) => void
}

export default function BranchPicker({
  apiHost,
  repoPath,
  value,
  onChange,
  onCreateNew,
  createNewBranch,
  onCreateNewBranchChange,
}: Props) {
  const [branches, setBranches] = useState<Branch[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [newBranchName, setNewBranchName] = useState('')

  useEffect(() => {
    if (!repoPath) {
      setBranches([])
      return
    }

    const fetchBranches = async () => {
      setLoading(true)
      setError(null)
      try {
        const res = await fetch(
          `http://${apiHost}/api/sessions/branches?repo_path=${encodeURIComponent(repoPath)}`
        )
        if (!res.ok) {
          const data = await res.json()
          throw new Error(data.detail || 'Failed to fetch branches')
        }
        const data = await res.json()
        setBranches(data.branches || [])
      } catch (err) {
        setError(err instanceof Error ? err.message : 'Failed to fetch branches')
        setBranches([])
      } finally {
        setLoading(false)
      }
    }

    fetchBranches()
  }, [apiHost, repoPath])

  const availableBranches = branches.filter((b) => b.available)
  const unavailableBranches = branches.filter((b) => !b.available)

  if (loading) {
    return (
      <div className="text-sm text-text-tertiary py-2">
        Loading branches...
      </div>
    )
  }

  if (error) {
    return (
      <div className="text-sm text-red-400 py-2">
        {error}
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {/* Toggle between existing and new branch */}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => onCreateNewBranchChange(false)}
          className={`px-3 py-1.5 text-sm rounded transition-colors ${
            !createNewBranch
              ? 'bg-blue-600 text-text-primary'
              : 'bg-control-bg text-text-tertiary hover:text-text-primary'
          }`}
        >
          Existing Branch
        </button>
        <button
          type="button"
          onClick={() => onCreateNewBranchChange(true)}
          className={`px-3 py-1.5 text-sm rounded transition-colors ${
            createNewBranch
              ? 'bg-blue-600 text-text-primary'
              : 'bg-control-bg text-text-tertiary hover:text-text-primary'
          }`}
        >
          New Branch
        </button>
      </div>

      {createNewBranch ? (
        <div>
          <input
            type="text"
            value={newBranchName}
            onChange={(e) => {
              setNewBranchName(e.target.value)
              onCreateNew(e.target.value)
            }}
            placeholder="e.g., feat/new-feature"
            className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
          />
          <p className="text-xs text-text-muted mt-1">
            Branch will be created from current HEAD
          </p>
        </div>
      ) : (
        <div>
          <select
            value={value}
            onChange={(e) => onChange(e.target.value)}
            className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500"
          >
            <option value="">Select a branch...</option>
            {availableBranches.length > 0 && (
              <optgroup label="Available">
                {availableBranches.map((branch) => (
                  <option key={branch.name} value={branch.name}>
                    {branch.name} {branch.current ? '(current)' : ''}
                  </option>
                ))}
              </optgroup>
            )}
            {unavailableBranches.length > 0 && (
              <optgroup label="In Use (already in a worktree)">
                {unavailableBranches.map((branch) => (
                  <option key={branch.name} value={branch.name} disabled>
                    {branch.name}
                  </option>
                ))}
              </optgroup>
            )}
          </select>
          {branches.length === 0 && (
            <p className="text-xs text-text-muted mt-1">
              No branches found. Select a repository first.
            </p>
          )}
          {availableBranches.length === 0 && branches.length > 0 && (
            <p className="text-xs text-yellow-500 mt-1">
              All branches are in use. Create a new branch instead.
            </p>
          )}
        </div>
      )}
    </div>
  )
}
