type SessionMode = 'existing' | 'new' | 'worktree'

const MODE_OPTIONS = [
  { key: 'existing' as const, label: 'Existing Repo', desc: 'Use existing directory' },
  { key: 'new' as const, label: 'New Repo', desc: 'Create new git repo' },
  { key: 'worktree' as const, label: 'Worktree', desc: 'Create git worktree' },
]

interface Props {
  mode: SessionMode
  onModeChange: (mode: SessionMode) => void
}

export default function ModeToggle({ mode, onModeChange }: Props) {
  return (
    <div>
      <label className="block text-sm text-text-tertiary mb-2">Session Type</label>
      <div className="flex gap-2">
        {MODE_OPTIONS.map((opt) => (
          <button
            key={opt.key}
            type="button"
            onClick={() => onModeChange(opt.key)}
            className={`flex-1 px-3 py-2 text-sm rounded-[var(--radius-md)] transition-colors ${
              mode === opt.key
                ? 'bg-action text-white'
                : 'bg-control-bg text-text-tertiary hover:text-text-primary hover:bg-control-bg-hover'
            }`}
          >
            <div className="font-medium">{opt.label}</div>
            <div className="text-xs opacity-75 mt-0.5">{opt.desc}</div>
          </button>
        ))}
      </div>
    </div>
  )
}
