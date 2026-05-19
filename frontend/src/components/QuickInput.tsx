import { useState, useCallback } from 'react'
import type { KeyboardEvent } from 'react'
import Button from './ui/Button'

interface QuickInputProps {
  onSend: (text: string) => void
  disabled?: boolean
  placeholder?: string
}

export default function QuickInput({
  onSend,
  disabled = false,
  placeholder = 'Type command and press Enter...',
}: QuickInputProps) {
  const [value, setValue] = useState('')

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLInputElement>) => {
      if (e.key === 'Enter' && value.trim() && !disabled) {
        onSend(value)
        setValue('')
      }
    },
    [value, onSend, disabled]
  )

  const handleSendClick = useCallback(() => {
    if (value.trim() && !disabled) {
      onSend(value)
      setValue('')
    }
  }, [value, onSend, disabled])

  return (
    <div className="flex gap-2">
      <input
        type="text"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        onKeyDown={handleKeyDown}
        disabled={disabled}
        placeholder={placeholder}
        className="flex-1 bg-input-bg text-text-primary px-3.5 py-2.5 rounded-[var(--radius-lg)] border border-input-border inset
                   focus:outline-none focus:border-action/50 focus:shadow-[inset_0_1px_3px_rgba(0,0,0,0.2),0_0_0_3px_rgba(10,132,255,0.15)] transition-all duration-200
                   disabled:opacity-50 text-base" // text-base prevents iOS zoom on focus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <Button variant="primary" onClick={handleSendClick} disabled={disabled || !value.trim()}>
        Send
      </Button>
    </div>
  )
}
