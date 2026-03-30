import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { getApiBase } from '../config'
import { useIsDesktop } from '../hooks/useMediaQuery'
import type { SessionBase } from '../utils/sessionStatus'
import { getSessionStatus, statusColorClasses } from '../utils/sessionStatus'

const statusRingClasses: Record<string, string> = {
  gray: 'ring-gray-500/60',
  yellow: 'ring-yellow-400/60',
  green: 'ring-green-500/60',
  red: 'ring-red-500/60',
}

interface Props {
  currentSessionName: string
  compact?: boolean
}

export default function SessionNavigatorDots({ currentSessionName, compact = false }: Props) {
  const isDesktop = useIsDesktop()
  const navigate = useNavigate()
  const [sessions, setSessions] = useState<SessionBase[]>([])
  const prevStates = useRef<Record<string, string>>({})
  const [alerting, setAlerting] = useState<Record<string, boolean>>({})

  useEffect(() => {
    const fetchSessions = async () => {
      try {
        const res = await fetch(`${getApiBase()}/sessions`)
        if (!res.ok) return
        const data = await res.json()
        const active = (data.sessions || [])
          .filter((s: SessionBase) => s.alive && !s.paused)
          .sort((a: SessionBase, b: SessionBase) => a.name.localeCompare(b.name))
        setSessions(active)

        // Detect transitions away from 'working' to trigger 3-pulse alert
        const newAlerting: Record<string, boolean> = {}
        for (const s of active as SessionBase[]) {
          const prev = prevStates.current[s.name]
          const curr = s.idleState || 'unknown'
          if (prev === 'working' && curr !== 'working') {
            newAlerting[s.name] = true
          }
          prevStates.current[s.name] = curr
        }
        if (Object.keys(newAlerting).length > 0) {
          setAlerting((a) => ({ ...a, ...newAlerting }))
          // Clear after 3 pulses (~1.5s at 0.5s per pulse)
          setTimeout(() => {
            setAlerting((a) => {
              const next = { ...a }
              for (const name of Object.keys(newAlerting)) {
                delete next[name]
              }
              return next
            })
          }, 1500)
        }
      } catch {
        // Ignore fetch errors
      }
    }

    fetchSessions()
    const interval = setInterval(fetchSessions, 5000)
    return () => clearInterval(interval)
  }, [])

  if (!compact && !isDesktop) return null

  const getInitial = (label: string) => {
    if (label.includes('-')) {
      const parts = label.split('-')
      return (parts[0][0] + parts[1][0]).toUpperCase()
    }
    const camelMatch = label.match(/^(.).*?([A-Z])/)
    if (camelMatch) {
      return (camelMatch[1] + camelMatch[2]).toUpperCase()
    }
    return label.slice(0, 2).toUpperCase()
  }

  const dots = sessions.map((s) => {
    const status = getSessionStatus(s)
    const colors = statusColorClasses[status.color]
    const isCurrent = s.name === currentSessionName
    const isPulsing = alerting[s.name]

    if (compact) {
      return (
        <button
          key={s.name}
          onClick={() => navigate(`/session/${s.name}`)}
          title={`${s.displayName || s.name} — ${status.label}`}
          className={`shrink-0 rounded-full transition-all ${colors.dot} flex items-center justify-center font-bold text-black/60 text-[8px] ${
            isCurrent
              ? `w-6 h-6 ring-2 ${s.theOne ? 'ring-blue-400' : statusRingClasses[status.color]} ring-offset-1 ring-offset-[var(--bg-surface)]`
              : `w-5 h-5 hover:scale-110${s.theOne ? ' ring-1 ring-blue-400/50' : ''}`
          } ${isPulsing ? 'animate-[pulse-dot_1.2s_ease-in-out_3]' : ''}`}
        >
          {getInitial(s.displayName || s.name)}
        </button>
      )
    }

    return (
      <button
        key={s.name}
        onClick={() => navigate(`/session/${s.name}`)}
        title={`${s.displayName || s.name} — ${status.label}`}
        className={`rounded-full transition-all ${colors.dot} flex items-center justify-center font-bold text-black/60 ${
          isCurrent
            ? `w-7 h-7 text-sm ring-2 ${s.theOne ? 'ring-blue-400' : statusRingClasses[status.color]} ring-offset-1 ring-offset-[var(--bg-surface)]`
            : `w-7 h-7 text-sm hover:scale-110${s.theOne ? ' ring-1 ring-blue-400/50' : ''}`
        } ${isPulsing ? 'animate-[pulse-dot_1.2s_ease-in-out_3]' : ''}`}
      >
        {getInitial(s.displayName || s.name)}
      </button>
    )
  })

  const starredNames = new Set(sessions.filter((s) => s.theOne).map((s) => s.name))
  const starredDots = dots.filter((d) => starredNames.has(d.key as string))
  const restDots = dots.filter((d) => !starredNames.has(d.key as string))

  if (compact) {
    return (
      <div className="flex items-center gap-1 shrink-0">
        {starredDots}
        {starredDots.length > 0 && restDots.length > 0 && (
          <div className="w-0.5 h-3.5 bg-text-secondary/50 mx-1 shrink-0 rounded-full" />
        )}
        {restDots}
      </div>
    )
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex items-center gap-1.5">
        {starredDots}
        {starredDots.length > 0 && restDots.length > 0 && (
          <div className="w-0.5 h-4 bg-text-secondary/50 mx-1 shrink-0 rounded-full" />
        )}
        {restDots}
      </div>
    </div>
  )
}
