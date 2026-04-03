import { useState } from 'react'
import { Zap, ArrowRight, X } from 'lucide-react'
import { getApiBase } from '../config'

interface Props {
  sessionName: string
  isScratch: boolean
  onPromoted: () => void
}

export default function ScratchPromoteBanner({ sessionName, isScratch, onPromoted }: Props) {
  const [expanded, setExpanded] = useState(false)
  const [workdir, setWorkdir] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isScratch) return null

  const handlePromote = async () => {
    if (!workdir.trim()) return
    setSubmitting(true)
    setError(null)
    try {
      const res = await fetch(`${getApiBase()}/sessions/${sessionName}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          workdir: workdir.trim(),
          scratch: false,
          ...(displayName.trim() ? { displayName: displayName.trim() } : {}),
        }),
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to promote session')
      }
      onPromoted()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to promote session')
    } finally {
      setSubmitting(false)
    }
  }

  if (!expanded) {
    return (
      <div className="flex items-center justify-between px-3 py-1.5 bg-amber-900/30 border-b border-amber-700/50">
        <div className="flex items-center gap-2 text-xs text-amber-400">
          <Zap size={12} />
          <span>Scratch session</span>
        </div>
        <button
          onClick={() => setExpanded(true)}
          className="flex items-center gap-1 text-xs text-amber-400 hover:text-amber-300 transition-colors"
        >
          Assign to project
          <ArrowRight size={12} />
        </button>
      </div>
    )
  }

  return (
    <div className="px-3 py-2 bg-amber-900/30 border-b border-amber-700/50">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs text-amber-400 font-medium">Assign to project</span>
        <button
          onClick={() => setExpanded(false)}
          className="p-0.5 text-text-muted hover:text-text-primary transition-colors"
        >
          <X size={14} />
        </button>
      </div>
      <div className="flex flex-col sm:flex-row gap-2">
        <input
          type="text"
          value={workdir}
          onChange={(e) => setWorkdir(e.target.value)}
          placeholder="Project directory (e.g. ~/src/my-project)"
          className="flex-1 px-2 py-1 text-sm bg-bg-base border border-border-default rounded focus:border-amber-500 focus:outline-none"
        />
        <input
          type="text"
          value={displayName}
          onChange={(e) => setDisplayName(e.target.value)}
          placeholder="Session name (optional)"
          className="sm:w-40 px-2 py-1 text-sm bg-bg-base border border-border-default rounded focus:border-amber-500 focus:outline-none"
        />
        <div className="flex gap-2">
          <button
            onClick={handlePromote}
            disabled={!workdir.trim() || submitting}
            className="px-3 py-1 text-sm bg-amber-600 hover:bg-amber-500 disabled:opacity-50 rounded transition-colors"
          >
            {submitting ? 'Promoting...' : 'Promote'}
          </button>
          <button
            onClick={() => setExpanded(false)}
            className="px-3 py-1 text-sm bg-control-bg hover:bg-control-bg-hover rounded transition-colors"
          >
            Cancel
          </button>
        </div>
      </div>
      {error && <p className="mt-1 text-xs text-red-400">{error}</p>}
    </div>
  )
}
