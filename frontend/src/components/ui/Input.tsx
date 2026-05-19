import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'

const inputClasses =
  'w-full bg-input-bg text-text-primary border border-input-border rounded-[var(--radius-lg)] px-3.5 py-2.5 text-sm inset placeholder:text-text-tertiary focus:outline-none focus:border-action/50 focus:shadow-[inset_0_1px_3px_rgba(0,0,0,0.2),0_0_0_3px_rgba(10,132,255,0.15)] transition-all duration-200'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className = '', ...props }, ref) => (
    <input ref={ref} className={`${inputClasses} ${className}`} {...props} />
  )
)
Input.displayName = 'Input'

export const TextArea = forwardRef<
  HTMLTextAreaElement,
  TextareaHTMLAttributes<HTMLTextAreaElement>
>(({ className = '', ...props }, ref) => (
  <textarea ref={ref} className={`${inputClasses} resize-y ${className}`} {...props} />
))
TextArea.displayName = 'TextArea'
