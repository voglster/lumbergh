interface Props {
  password: string
  onPasswordChange: (value: string) => void
  passwordSet: boolean
  passwordSource: string | null
  restartNeeded: boolean
}

export default function SecuritySettings({
  password,
  onPasswordChange,
  passwordSet,
  passwordSource,
  restartNeeded,
}: Props) {
  if (restartNeeded) {
    return (
      <div className="space-y-4">
        <div className="p-3 bg-warning/10 border border-warning/30 rounded text-sm text-warning">
          Password updated. Restart Lumbergh for the change to take effect.
        </div>
      </div>
    )
  }

  if (passwordSource === 'env') {
    return (
      <div className="space-y-4">
        <div className="p-3 bg-bg-elevated/50 rounded text-sm text-text-muted">
          Password is set via the <code className="text-text-secondary">LUMBERGH_PASSWORD</code>{' '}
          environment variable. To manage it here instead, remove the env var and restart.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      <div>
        <label className="block text-sm text-text-tertiary mb-1">Password</label>
        <input
          type="password"
          value={password}
          onChange={(e) => onPasswordChange(e.target.value)}
          placeholder={passwordSet ? '(unchanged)' : 'Set a password to enable auth'}
          className="w-full px-3 py-2 bg-input-bg text-text-primary rounded-[var(--radius-lg)] border border-input-border focus:outline-none focus:border-action/50 font-mono text-sm"
        />
        <p className="text-xs text-text-muted mt-1">
          {passwordSet
            ? 'Enter a new password to change it, or clear it to disable auth.'
            : 'Anyone with network access can currently view and control sessions.'}
        </p>
      </div>
      {passwordSet && (
        <button
          type="button"
          onClick={() => onPasswordChange('')}
          className="text-sm text-danger hover:text-danger/80 transition-colors"
        >
          Remove password
        </button>
      )}
    </div>
  )
}
