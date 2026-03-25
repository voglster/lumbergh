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
}

export default function SessionNavigatorDots({ currentSessionName }: Props) {
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

  if (!isDesktop) return null

  return (
    <div className="flex-1 flex items-center justify-center">
      <div className="flex items-center gap-3">
        {sessions.map((s) => {
          const status = getSessionStatus(s)
          const colors = statusColorClasses[status.color]
          const isCurrent = s.name === currentSessionName
          const initial = (s.displayName || s.name).charAt(0).toUpperCase()
          const isPulsing = alerting[s.name]

          return (
            <button
              key={s.name}
              onClick={() => navigate(`/session/${s.name}`)}
              title={`${s.displayName || s.name} — ${status.label}`}
              className={`rounded-full transition-all ${colors.dot} flex items-center justify-center font-bold text-black/60 ${
                isCurrent
                  ? `w-5 h-5 text-[11px] ring-2 ${statusRingClasses[status.color]} ring-offset-1 ring-offset-[var(--bg-surface)]`
                  : 'w-3.5 h-3.5 text-[9px] hover:scale-125'
              } ${isPulsing ? 'animate-[pulse-dot_1.2s_ease-in-out_3]' : ''}`}
            >
              {initial}
            </button>
          )
        })}
      </div>
    </div>
  )
}
