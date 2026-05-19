type StatusDotState = 'running' | 'idle' | 'stopped' | 'inactive' | 'connected' | 'disconnected'

interface StatusDotProps {
  state: StatusDotState
  pulse?: boolean
  className?: string
}

const stateStyles: Record<StatusDotState, { bg: string; glow: string }> = {
  running: { bg: 'bg-success', glow: 'shadow-[0_0_6px_rgba(48,209,88,0.4)]' },
  connected: { bg: 'bg-success', glow: 'shadow-[0_0_6px_rgba(48,209,88,0.4)]' },
  idle: { bg: 'bg-warning', glow: 'shadow-[0_0_6px_rgba(255,159,10,0.4)]' },
  stopped: { bg: 'bg-danger', glow: 'shadow-[0_0_6px_rgba(255,69,58,0.4)]' },
  disconnected: { bg: 'bg-danger', glow: 'shadow-[0_0_6px_rgba(255,69,58,0.4)]' },
  inactive: { bg: 'bg-text-tertiary', glow: '' },
}

export default function StatusDot({ state, pulse = false, className = '' }: StatusDotProps) {
  const { bg, glow } = stateStyles[state]
  return (
    <div
      className={`w-2 h-2 rounded-full ${bg} ${glow} ${pulse ? 'animate-[pulse-dot_2s_ease-in-out_infinite]' : ''} ${className}`}
    />
  )
}
