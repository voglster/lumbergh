import type { ReactNode } from 'react'

type BannerVariant = 'info' | 'warning' | 'danger'

interface BannerProps {
  variant?: BannerVariant
  icon?: ReactNode
  children: ReactNode
  action?: ReactNode
  className?: string
  onDismiss?: () => void
}

const variantClasses: Record<BannerVariant, string> = {
  info: 'bg-action/8 border-action/15 border-l-action',
  warning: 'bg-warning/8 border-warning/15 border-l-warning',
  danger: 'bg-danger/8 border-danger/15 border-l-danger',
}

export default function Banner({
  variant = 'info',
  icon,
  children,
  action,
  className = '',
  onDismiss,
}: BannerProps) {
  return (
    <div
      className={`border border-l-[3px] rounded-[var(--radius-lg)] px-4 py-3 flex items-center gap-3 ${variantClasses[variant]} ${className}`}
    >
      {icon && <span className="flex-shrink-0 text-base">{icon}</span>}
      <div className="flex-1 min-w-0 text-[13px] text-text-primary">{children}</div>
      {action && <div className="flex-shrink-0">{action}</div>}
      {onDismiss && (
        <button
          onClick={onDismiss}
          className="flex-shrink-0 text-text-tertiary hover:text-text-primary cursor-pointer"
        >
          ✕
        </button>
      )}
    </div>
  )
}
