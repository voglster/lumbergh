export interface SessionBase {
  name: string
  alive: boolean
  idleState?: 'unknown' | 'idle' | 'working' | 'error' | 'stalled' | null
  paused?: boolean
  displayName: string | null
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
  gray: { dot: 'bg-gray-500', text: 'text-text-tertiary' },
  yellow: { dot: 'bg-yellow-400', text: 'text-yellow-400' },
  green: { dot: 'bg-green-500', text: 'text-green-400' },
  red: { dot: 'bg-red-500', text: 'text-red-400' },
}
