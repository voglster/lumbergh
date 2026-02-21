interface SendToTerminalButtonsProps {
  onSend: (sendEnter: boolean) => void
  disabled?: boolean
  className?: string
}

/**
 * A pair of buttons for sending content to the terminal.
 * - ▷ (yellow): Send text without pressing Enter
 * - ➤ (blue): Send text and press Enter
 */
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
        className="text-xl text-text-muted hover:text-yellow-400 disabled:text-text-muted disabled:cursor-not-allowed transition-colors px-1"
        title="Send text (no Enter)"
      >
        &#x25B7;
      </button>
      <button
        onClick={() => onSend(true)}
        disabled={disabled}
        className="text-xl text-text-muted hover:text-blue-400 disabled:text-text-muted disabled:cursor-not-allowed transition-colors px-1"
        title="Send + Enter (yolo)"
      >
        &#x27A4;
      </button>
    </span>
  )
}
