import { useState, useCallback } from 'react'
import type { KeyboardEvent } from 'react'

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
        className="flex-1 bg-gray-700 text-white px-3 py-2 rounded border border-gray-600
                   focus:outline-none focus:border-blue-500 disabled:opacity-50
                   text-base" // text-base prevents iOS zoom on focus
        autoComplete="off"
        autoCorrect="off"
        autoCapitalize="off"
        spellCheck={false}
      />
      <button
        onClick={handleSendClick}
        disabled={disabled || !value.trim()}
        className="bg-blue-600 hover:bg-blue-700 disabled:bg-gray-600 disabled:cursor-not-allowed
                   text-white px-4 py-2 rounded font-medium transition-colors"
      >
        Send
      </button>
    </div>
  )
}
