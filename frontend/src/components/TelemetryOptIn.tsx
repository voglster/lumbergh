import { useState, useEffect } from 'react'
import { getApiBase } from '../config'

interface Props {
  onClose: () => void
}

const GUILT_TRIPS = [
  {
    speaker: 'Lumbergh',
    quote:
      'Yeahhh... if you could go ahead and enable those analytics, that would be greaaaat. Mmmkay?',
  },
  {
    speaker: 'Milton',
    quote: 'I... I was told there would be analytics. I could set the building on fire...',
  },
  {
    speaker: 'Lumbergh',
    quote:
      "Without analytics we can't file our TPS reports. And you remember what happened last time we didn't file our TPS reports.",
  },
  {
    speaker: 'Milton',
    quote: 'First they took my stapler. Then they took my analytics. I... I could...',
  },
  {
    speaker: 'Stan',
    quote:
      'We need you to have at least 15 pieces of flair. Analytics is one of them. Do you really want to be a bare minimum person?',
  },
  {
    speaker: 'Lumbergh',
    quote:
      "I'm gonna need you to go ahead and come in on Saturday... and turn those analytics back on.",
  },
  {
    speaker: 'Lumbergh',
    quote:
      "Oh, and remember: Friday is Hawaiian shirt day. But without analytics, we won't know if anyone showed up.",
  },
  {
    speaker: 'Milton',
    quote:
      "Excuse me... I believe you have my analytics. And if you don't give them back, I'm going to have to... I'll... I could...",
  },
]

const DECLINE_BUTTON_LABELS = [
  'No thanks, I prefer mystery bugs',
  'No thanks, I enjoy chaos',
  'Nah, let Lumbergh guess',
  "No thanks, I'll file my own TPS reports",
  'No thanks, I like surprises',
]

export default function TelemetryOptIn({ onClose }: Props) {
  const [saving, setSaving] = useState(false)
  const [guiltTrip, setGuiltTrip] = useState<(typeof GUILT_TRIPS)[number] | null>(null)
  const [countdown, setCountdown] = useState(0)

  // Random decline button text (stable for the lifetime of the modal)
  const [declineLabel] = useState(
    () => DECLINE_BUTTON_LABELS[Math.floor(Math.random() * DECLINE_BUTTON_LABELS.length)]
  )

  // Auto-dismiss guilt trip after countdown
  useEffect(() => {
    if (!guiltTrip) return
    if (countdown <= 0) {
      onClose()
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [guiltTrip, countdown, onClose])

  const respond = async (consent: boolean) => {
    setSaving(true)
    try {
      await fetch(`${getApiBase()}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telemetryConsent: consent }),
      })
    } catch {
      // Best-effort
    }

    if (consent) {
      onClose()
    } else {
      // Show guilt trip
      setGuiltTrip(GUILT_TRIPS[Math.floor(Math.random() * GUILT_TRIPS.length)])
      setCountdown(6)
    }
  }

  // Guilt trip interstitial
  if (guiltTrip) {
    return (
      <div className="fixed inset-0 bg-bg-overlay flex items-center justify-center z-50 p-4">
        <div className="bg-bg-surface rounded-lg w-full max-w-sm border border-border-default p-6 space-y-4 text-center">
          <div className="text-4xl leading-none">
            {guiltTrip.speaker === 'Milton' ? (
              <span className="font-mono tracking-tighter">-_-</span>
            ) : guiltTrip.speaker === 'Stan' ? (
              <span>&#127894;</span>
            ) : (
              <span>&#9749;</span>
            )}
          </div>
          <p className="text-sm text-text-secondary italic leading-relaxed">"{guiltTrip.quote}"</p>
          <p className="text-xs text-text-muted">
            —{' '}
            {guiltTrip.speaker === 'Milton'
              ? 'Milton Waddams'
              : guiltTrip.speaker === 'Stan'
                ? "Stan, Chotchkie's Manager"
                : 'Bill Lumbergh'}
          </p>
          <div className="flex flex-col items-center gap-2 pt-2">
            <button
              onClick={onClose}
              className="text-xs text-text-muted hover:text-text-tertiary transition-colors"
            >
              Closing in {countdown}s...
            </button>
          </div>
        </div>
      </div>
    )
  }

  // Normal opt-in modal
  return (
    <div className="fixed inset-0 bg-bg-overlay flex items-center justify-center z-50 p-4">
      <div className="bg-bg-surface rounded-lg w-full max-w-sm border border-border-default p-6 space-y-4">
        <h2 className="text-lg font-semibold text-text-primary">Help Improve Lumbergh</h2>
        <p className="text-sm text-text-secondary">
          Send anonymous usage statistics to help us improve Lumbergh. No personal data, session
          content, or code is ever collected.{' '}
          <a
            href="https://app.lumbergh.dev/privacy"
            target="_blank"
            rel="noopener noreferrer"
            className="text-blue-400 hover:text-blue-300"
          >
            See what we collect
          </a>
          . You can change this at any time in Settings.
        </p>
        <div className="flex justify-end gap-3 pt-2">
          <button
            onClick={() => respond(false)}
            disabled={saving}
            className="px-4 py-2 text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50 text-sm"
          >
            {declineLabel}
          </button>
          <button
            onClick={() => respond(true)}
            disabled={saving}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-500 disabled:bg-control-bg-hover disabled:cursor-not-allowed text-white rounded transition-colors"
          >
            Enable Stats
          </button>
        </div>
      </div>
    </div>
  )
}
