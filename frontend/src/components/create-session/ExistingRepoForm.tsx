import DirectoryPicker from '../DirectoryPicker'

interface Props {
  workdir: string
  onWorkdirChange: (value: string) => void
  manualEntry: boolean
  onManualEntryChange: (value: boolean) => void
  dirStatus: 'unchecked' | 'checking' | 'exists' | 'not_found' | 'error'
}

export default function ExistingRepoForm({
  workdir,
  onWorkdirChange,
  manualEntry,
  onManualEntryChange,
  dirStatus,
}: Props) {
  return (
    <div>
      <label className="block text-sm text-text-tertiary mb-1">Working Directory</label>
      {manualEntry ? (
        <div>
          <input
            type="text"
            value={workdir}
            onChange={(e) => onWorkdirChange(e.target.value)}
            placeholder="e.g., /home/user/myproject"
            data-testid="workdir-input"
            className="w-full px-3 py-2 bg-input-bg text-text-primary rounded-[var(--radius-lg)] border border-input-border focus:outline-none focus:border-action/50 font-mono text-sm"
            required
          />
          {dirStatus === 'checking' && <p className="text-xs text-text-muted mt-1">Checking...</p>}
          {dirStatus === 'exists' && <p className="text-xs text-success mt-1">Directory exists</p>}
          {dirStatus === 'not_found' && (
            <p className="text-xs text-warning mt-1">
              Directory not found — use the &quot;New Repo&quot; tab to create one
            </p>
          )}
          <button
            type="button"
            onClick={() => {
              onManualEntryChange(false)
              onWorkdirChange('')
            }}
            className="mt-2 text-xs text-action hover:text-action/80 transition-colors"
          >
            Search repositories instead
          </button>
        </div>
      ) : (
        <DirectoryPicker
          value={workdir}
          onChange={onWorkdirChange}
          onManualEntry={() => onManualEntryChange(true)}
        />
      )}
    </div>
  )
}
