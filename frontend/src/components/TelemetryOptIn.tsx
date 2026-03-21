import { useState } from 'react'
import { getApiBase } from '../config'

interface Props {
  onClose: () => void
}

export default function TelemetryOptIn({ onClose }: Props) {
  const [saving, setSaving] = useState(false)

  const respond = async (consent: boolean) => {
    setSaving(true)
    try {
      await fetch(`${getApiBase()}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ telemetryConsent: consent }),
      })
    } catch {
      // Best-effort — don't block the user
    }
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-bg-overlay flex items-center justify-center z-50 p-4">
      <div className="bg-bg-surface rounded-lg w-full max-w-sm border border-border-default p-6 space-y-4">
        <h2 className="text-lg font-semibold text-text-primary">Help Improve Lumbergh</h2>
        <p className="text-sm text-text-secondary">
          Send anonymous usage statistics to help us improve Lumbergh. No personal data, session
          content, or code is ever collected.{' '}
          <a
            href="https://lumbergh.jc.turbo.inc/privacy"
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
            className="px-4 py-2 text-text-tertiary hover:text-text-primary transition-colors disabled:opacity-50"
          >
            No Thanks
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
