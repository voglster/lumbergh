import { Play, SendHorizonal } from 'lucide-react'

interface SendToTerminalButtonsProps {
  onSend: (sendEnter: boolean) => void
  disabled?: boolean
  className?: string
}

export default function SendToTerminalButtons({
  onSend,
  disabled = false,
  className = '',
}: SendToTerminalButtonsProps) {
  return (
    <span className={className}>
      <button
        onClick={() => onSend(false)}
        disabled={disabled}
        className="text-text-muted hover:text-warning disabled:text-text-muted disabled:cursor-not-allowed transition-colors px-1"
        title="Send text (no Enter)"
      >
        <Play size={18} />
      </button>
      <button
        onClick={() => onSend(true)}
        disabled={disabled}
        className="text-text-muted hover:text-action disabled:text-text-muted disabled:cursor-not-allowed transition-colors px-1"
        title="Send + Enter (yolo)"
      >
        <SendHorizonal size={18} />
      </button>
    </span>
  )
}
