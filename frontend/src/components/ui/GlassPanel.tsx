import { forwardRef, type HTMLAttributes } from 'react'

type GlassVariant = 'default' | 'elevated' | 'inset'

interface GlassPanelProps extends HTMLAttributes<HTMLDivElement> {
  variant?: GlassVariant
  padding?: 'none' | 'sm' | 'md' | 'lg'
  radius?: 'md' | 'lg' | 'xl' | '2xl'
  hover?: boolean
}

const variantClasses: Record<GlassVariant, string> = {
  default: 'glass shadow-[var(--shadow-low)]',
  elevated: 'glass-elevated shadow-[var(--shadow-medium)]',
  inset: 'inset',
}

const paddingClasses = {
  none: '',
  sm: 'p-2',
  md: 'p-4',
  lg: 'p-6',
}

const radiusClasses = {
  md: 'rounded-[var(--radius-md)]',
  lg: 'rounded-[var(--radius-lg)]',
  xl: 'rounded-[var(--radius-xl)]',
  '2xl': 'rounded-[var(--radius-2xl)]',
}

const GlassPanel = forwardRef<HTMLDivElement, GlassPanelProps>(
  (
    {
      variant = 'default',
      padding = 'md',
      radius = 'xl',
      hover = false,
      className = '',
      children,
      ...props
    },
    ref
  ) => {
    const hoverClass =
      hover && variant === 'default'
        ? 'transition-all duration-200 hover:bg-bg-glass-hover hover:border-border-hover hover:shadow-[var(--shadow-medium)]'
        : ''

    return (
      <div
        ref={ref}
        className={`${variantClasses[variant]} ${paddingClasses[padding]} ${radiusClasses[radius]} ${hoverClass} ${className}`}
        {...props}
      >
        {children}
      </div>
    )
  }
)
GlassPanel.displayName = 'GlassPanel'
export default GlassPanel
