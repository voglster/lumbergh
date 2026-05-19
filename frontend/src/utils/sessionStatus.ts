export interface SessionBase {
  name: string
  alive: boolean
  idleState?: 'unknown' | 'idle' | 'working' | 'error' | 'stalled' | null
  paused?: boolean
  displayName: string | null
  theOne?: boolean
}

export function getSessionStatus(session: SessionBase): {
  color: string
  pulse: boolean
  label: string
} {
  if (!session.alive) {
    return { color: 'gray', pulse: false, label: 'Offline' }
  }
  switch (session.idleState) {
    case 'idle':
      return { color: 'yellow', pulse: true, label: 'Waiting for input' }
    case 'working':
      return { color: 'green', pulse: false, label: 'Working' }
    case 'error':
      return { color: 'red', pulse: true, label: 'Error' }
    case 'stalled':
      return { color: 'red', pulse: true, label: 'Stalled' }
    default:
      return { color: 'green', pulse: false, label: 'Active' }
  }
}

export const statusColorClasses: Record<string, { dot: string; text: string }> = {
  gray: { dot: 'bg-text-tertiary', text: 'text-text-tertiary' },
  yellow: { dot: 'bg-warning shadow-[0_0_6px_rgba(255,159,10,0.4)]', text: 'text-warning' },
  green: { dot: 'bg-success shadow-[0_0_6px_rgba(48,209,88,0.4)]', text: 'text-success' },
  red: { dot: 'bg-danger shadow-[0_0_6px_rgba(255,69,58,0.4)]', text: 'text-danger' },
}
