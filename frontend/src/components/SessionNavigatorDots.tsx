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

    const tooltipText = `${s.displayName || s.name} — ${status.label}`

    if (compact) {
      return (
        <div key={s.name} className="group relative shrink-0">
          <button
            onClick={() => navigate(`/session/${s.name}`)}
            className={`shrink-0 rounded-full transition-all ${colors.dot} flex items-center justify-center font-bold text-black/60 text-[8px] ${
              isCurrent
                ? `w-6 h-6 ring-2 ${statusRingClasses[status.color]} ring-offset-1 ring-offset-[var(--bg-surface)]`
                : 'w-5 h-5 hover:scale-110'
            } ${isPulsing ? 'animate-[pulse-dot_1.2s_ease-in-out_3]' : ''}`}
          >
            {getInitial(s.displayName || s.name)}
          </button>
          <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity z-50">
            {tooltipText}
          </span>
        </div>
      )
    }

    return (
      <div key={s.name} className="group relative">
        <button
          onClick={() => navigate(`/session/${s.name}`)}
          className={`rounded-full transition-all ${colors.dot} flex items-center justify-center font-bold text-black/60 ${
            isCurrent
              ? `w-7 h-7 text-sm ring-2 ${statusRingClasses[status.color]} ring-offset-1 ring-offset-[var(--bg-surface)]`
              : 'w-7 h-7 text-sm hover:scale-110'
          } ${isPulsing ? 'animate-[pulse-dot_1.2s_ease-in-out_3]' : ''}`}
        >
          {getInitial(s.displayName || s.name)}
        </button>
        <span className="pointer-events-none absolute left-1/2 -translate-x-1/2 top-full mt-1.5 whitespace-nowrap rounded bg-gray-900 px-2 py-1 text-xs text-white opacity-0 group-hover:opacity-100 transition-opacity z-50">
          {tooltipText}
        </span>
      </div>
    )
  })

  if (compact) {
    return <div className="flex items-center gap-1 shrink-0">{dots}</div>
  }

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex items-center gap-1.5">{dots}</div>
    </div>
  )
}
