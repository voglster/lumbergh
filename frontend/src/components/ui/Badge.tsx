import type { ReactNode } from 'react'

type BadgeVariant = 'action' | 'success' | 'warning' | 'danger' | 'neutral' | 'purple'

interface BadgeProps {
  variant?: BadgeVariant
  children: ReactNode
  className?: string
}

const variantClasses: Record<BadgeVariant, string> = {
  action: 'bg-action/12 text-action',
  success: 'bg-success/12 text-success',
  warning: 'bg-warning/12 text-warning',
  danger: 'bg-danger/12 text-danger',
  neutral: 'bg-control-bg text-text-tertiary',
  purple: 'bg-purple/12 text-purple',
}

export default function Badge({ variant = 'neutral', children, className = '' }: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center gap-1 text-[11px] font-medium rounded-[var(--radius-sm)] px-2 py-0.5 ${variantClasses[variant]} ${className}`}
    >
      {children}
    </span>
  )
}
