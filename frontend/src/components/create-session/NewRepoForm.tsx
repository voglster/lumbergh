interface Props {
  projectName: string
  onProjectNameChange: (value: string) => void
  projectSlug: string
  parentDir: string
  onParentDirChange: (value: string) => void
  editingParentDir: boolean
  onEditingParentDirChange: (value: boolean) => void
  newRepoPath: string
  slug: string
}

export default function NewRepoForm({
  projectName,
  onProjectNameChange,
  projectSlug,
  parentDir,
  onParentDirChange,
  editingParentDir,
  onEditingParentDirChange,
  newRepoPath,
  slug,
}: Props) {
  return (
    <>
      <div>
        <label className="block text-sm text-text-tertiary mb-1">Project Name</label>
        <input
          type="text"
          value={projectName}
          onChange={(e) => onProjectNameChange(e.target.value)}
          placeholder="e.g., my-new-project"
          data-testid="project-name-input"
          className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500"
          autoFocus
        />
        {projectSlug && projectSlug !== projectName && (
          <p className="text-xs text-text-muted mt-1">
            Directory name: <span className="text-text-tertiary font-mono">{projectSlug}</span>
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
              onChange={(e) => onParentDirChange(e.target.value)}
              placeholder="e.g., /home/user/src"
              className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
            />
            <button
              type="button"
              onClick={() => onEditingParentDirChange(false)}
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
              onClick={() => onEditingParentDirChange(true)}
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
  )
}
