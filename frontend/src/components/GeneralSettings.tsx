import { useState } from 'react'

interface Props {
  repoSearchDir: string
  onRepoSearchDirChange: (value: string) => void
  gitGraphCommits: string
  onGitGraphCommitsChange: (value: string) => void
  defaultAgent: string
  onDefaultAgentChange: (value: string) => void
  agentProviders: Record<string, { label: string }>
  tabVisibility: Record<string, boolean>
  onTabVisibilityChange: (value: Record<string, boolean>) => void
  showSessionDots: boolean
  onShowSessionDotsChange: (value: boolean) => void
  telemetryConsent: boolean
  onTelemetryConsentChange: (value: boolean) => void
}

const TELEMETRY_QUOTES = [
  {
    quote:
      'Yeahhh... if you could go ahead and keep those analytics on, that would be greaaaat. Mmmkay?',
    speaker: 'Bill Lumbergh',
    isMilton: false,
  },
  {
    quote: 'I... I was told there would be analytics. I could set the building on fire...',
    speaker: 'Milton Waddams',
    isMilton: true,
  },
  {
    quote:
      "Without analytics we can't file our TPS reports. And you remember what happened last time.",
    speaker: 'Bill Lumbergh',
    isMilton: false,
  },
  {
    quote: 'First they took my stapler. Then they took my analytics. I... I could...',
    speaker: 'Milton Waddams',
    isMilton: true,
  },
  {
    quote:
      "I'm gonna need you to go ahead and come in on Saturday... and turn those analytics back on.",
    speaker: 'Bill Lumbergh',
    isMilton: false,
  },
  {
    quote:
      'We need at least 15 pieces of flair. Analytics is one of them. Do you really want to be a bare minimum person?',
    speaker: "Stan, Chotchkie's",
    isMilton: false,
  },
  {
    quote:
      "Oh, and remember: Friday is Hawaiian shirt day. But without analytics, we won't know if anyone showed up.",
    speaker: 'Bill Lumbergh',
    isMilton: false,
  },
  {
    quote:
      "Excuse me... I believe you have my analytics. And if you don't give them back, I'm going to have to... I'll...",
    speaker: 'Milton Waddams',
    isMilton: true,
  },
]

const TAB_OPTIONS: [string, string][] = [
  ['git', 'Git'],
  ['files', 'Files'],
  ['todos', 'Todos'],
  ['prompts', 'Prompts'],
  ['shared', 'Shared'],
]

function Toggle({ on, onChange }: { on: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={on}
      onClick={() => onChange(!on)}
      className={`relative inline-flex h-6 w-11 shrink-0 items-center rounded-full transition-colors ${
        on ? 'bg-blue-600' : 'bg-control-bg-hover'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 transform rounded-full bg-white transition-transform ${
          on ? 'translate-x-5.5' : 'translate-x-0.5'
        }`}
      />
    </button>
  )
}

export default function GeneralSettings({
  repoSearchDir,
  onRepoSearchDirChange,
  gitGraphCommits,
  onGitGraphCommitsChange,
  defaultAgent,
  onDefaultAgentChange,
  agentProviders,
  tabVisibility,
  onTabVisibilityChange,
  showSessionDots,
  onShowSessionDotsChange,
  telemetryConsent,
  onTelemetryConsentChange,
}: Props) {
  const [guiltTrip, setGuiltTrip] = useState<{
    quote: string
    speaker: string
    isMilton: boolean
  } | null>(null)

  return (
    <>
      {guiltTrip && (
        <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-[60] p-4">
          <div className="bg-bg-surface rounded-lg w-full max-w-sm border border-border-default p-6 space-y-4 text-center">
            <div className="text-4xl leading-none">
              {guiltTrip.isMilton ? (
                <span className="font-mono tracking-tighter">-_-</span>
              ) : (
                <span>&#9749;</span>
              )}
            </div>
            <p className="text-sm text-text-secondary italic leading-relaxed">
              &ldquo;{guiltTrip.quote}&rdquo;
            </p>
            <p className="text-xs text-text-muted">&mdash; {guiltTrip.speaker}</p>
            <div className="flex justify-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => {
                  onTelemetryConsentChange(false)
                  setGuiltTrip(null)
                }}
                className="px-4 py-2 text-text-tertiary hover:text-text-primary transition-colors text-sm"
              >
                Turn it off anyway
              </button>
              <button
                type="button"
                onClick={() => setGuiltTrip(null)}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-500 text-white rounded transition-colors text-sm"
              >
                Fine, keep it on
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="space-y-4">
        <div>
          <label className="block text-sm text-text-tertiary mb-1">
            Repository Search Directory
          </label>
          <input
            type="text"
            value={repoSearchDir}
            onChange={(e) => onRepoSearchDirChange(e.target.value)}
            placeholder="e.g., ~/src or /home/user/projects"
            className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
          />
          <p className="text-xs text-text-muted mt-1">Directory to search for git repositories</p>
        </div>
        <div>
          <label className="block text-sm text-text-tertiary mb-1">Git Graph Commits</label>
          <input
            type="number"
            min={10}
            max={1000}
            step={10}
            value={gitGraphCommits}
            onChange={(e) => onGitGraphCommitsChange(e.target.value)}
            className="w-32 px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 font-mono text-sm"
          />
          <p className="text-xs text-text-muted mt-1">
            Number of commits to show in the git graph (10-1000)
          </p>
        </div>
        {Object.keys(agentProviders).length > 1 && (
          <div>
            <label className="block text-sm text-text-tertiary mb-1">Default Agent</label>
            <select
              value={defaultAgent}
              onChange={(e) => onDefaultAgentChange(e.target.value)}
              className="w-full px-3 py-2 bg-input-bg text-text-primary rounded border border-input-border focus:outline-none focus:border-blue-500 text-sm"
            >
              {Object.entries(agentProviders).map(([key, provider]) => (
                <option key={key} value={key}>
                  {provider.label}
                </option>
              ))}
            </select>
            <p className="text-xs text-text-muted mt-1">Agent used for new sessions by default</p>
          </div>
        )}
        <div>
          <label className="block text-sm text-text-tertiary mb-2">Default Tab Visibility</label>
          <div className="flex flex-wrap gap-3">
            {TAB_OPTIONS.map(([key, label]) => {
              const isEnabled = tabVisibility[key] !== false
              const enabledCount = Object.values(tabVisibility).filter(Boolean).length
              const isLastEnabled = isEnabled && enabledCount <= 1
              return (
                <label
                  key={key}
                  className={`flex items-center gap-1.5 text-sm ${isLastEnabled ? 'opacity-50' : ''}`}
                >
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    disabled={isLastEnabled}
                    onChange={() =>
                      onTabVisibilityChange({ ...tabVisibility, [key]: !tabVisibility[key] })
                    }
                    className="rounded border-input-border bg-input-bg"
                  />
                  <span className="text-text-secondary">{label}</span>
                </label>
              )
            })}
          </div>
          <p className="text-xs text-text-muted mt-1">
            Tabs shown in the session detail view by default
          </p>
        </div>
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm text-text-tertiary">Session Navigator Dots</label>
            <p className="text-xs text-text-muted mt-0.5">
              Show session dots in the terminal header for quick switching
            </p>
          </div>
          <Toggle on={showSessionDots} onChange={onShowSessionDotsChange} />
        </div>
        <div className="flex items-center justify-between">
          <div>
            <label className="block text-sm text-text-tertiary">Anonymous Usage Statistics</label>
            <p className="text-xs text-text-muted mt-0.5">
              Help improve Lumbergh by sending anonymous usage data.{' '}
              <a
                href="https://app.lumbergh.dev/privacy"
                target="_blank"
                rel="noopener noreferrer"
                className="text-blue-400 hover:text-blue-300"
              >
                What we collect
              </a>
            </p>
          </div>
          <Toggle
            on={telemetryConsent}
            onChange={(on) => {
              if (!on) {
                setGuiltTrip(TELEMETRY_QUOTES[Math.floor(Math.random() * TELEMETRY_QUOTES.length)])
              } else {
                onTelemetryConsentChange(true)
              }
            }}
          />
        </div>
      </div>
    </>
  )
}
