import { useEffect, type ReactNode } from 'react'

interface ModalProps {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
  footer?: ReactNode
  maxWidth?: string
}

export default function Modal({
  open,
  onClose,
  title,
  children,
  footer,
  maxWidth = 'max-w-lg',
}: ModalProps) {
  useEffect(() => {
    if (!open) return
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [open, onClose])

  if (!open) return null

  return (
    <div
      className="fixed inset-0 bg-bg-overlay backdrop-blur-[8px] flex items-center justify-center z-50 p-4"
      onClick={onClose}
    >
      <div
        className={`bg-bg-surface border border-border-default rounded-[var(--radius-2xl)] w-full ${maxWidth} shadow-[var(--shadow-high)] flex flex-col max-h-[90vh]`}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between p-6 pb-4">
          <h2 className="text-[17px] font-semibold text-text-primary">{title}</h2>
          <button
            onClick={onClose}
            className="w-7 h-7 rounded-full bg-control-bg hover:bg-control-bg-hover flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          >
            ✕
          </button>
        </div>
        <div className="flex-1 overflow-y-auto px-6 pb-6">{children}</div>
        {footer && <div className="flex justify-end gap-2 px-6 pb-6 pt-2">{footer}</div>}
      </div>
    </div>
  )
}
