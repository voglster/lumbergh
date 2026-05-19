import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

type ButtonVariant = 'primary' | 'secondary' | 'danger' | 'ghost' | 'warning' | 'success'
type ButtonSize = 'sm' | 'md' | 'icon'

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant
  size?: ButtonSize
  children: ReactNode
}

const variantClasses: Record<ButtonVariant, string> = {
  primary: 'bg-action text-white shadow-[var(--shadow-low)] hover:brightness-110',
  secondary:
    'bg-control-bg text-text-primary border border-border-default hover:bg-control-bg-hover hover:border-border-hover',
  danger: 'bg-danger/15 text-danger border border-danger/20 hover:bg-danger/25',
  ghost: 'bg-transparent text-action hover:bg-control-bg',
  warning: 'bg-warning/15 text-warning border border-warning/20 hover:bg-warning/25',
  success: 'bg-success/15 text-success border border-success/20 hover:bg-success/25',
}

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-3 py-1 text-xs rounded-[var(--radius-sm)]',
  md: 'px-[18px] py-2 text-sm rounded-[var(--radius-md)]',
  icon: 'w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center',
}

const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ variant = 'secondary', size = 'md', className = '', children, disabled, ...props }, ref) => {
    return (
      <button
        ref={ref}
        className={`inline-flex items-center justify-center gap-1.5 font-medium transition-all duration-200 cursor-pointer ${variantClasses[variant]} ${sizeClasses[size]} ${disabled ? 'opacity-40 cursor-not-allowed' : ''} ${className}`}
        disabled={disabled}
        {...props}
      >
        {children}
      </button>
    )
  }
)
Button.displayName = 'Button'
export default Button
