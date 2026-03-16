import type { PromptTemplate } from '../utils/promptResolver'
import { useMentionInput } from '../hooks/useMentionInput'
import PromptDropdown from './PromptDropdown'

interface PromptMentionInputProps {
  value: string
  onChange: (value: string) => void
  prompts: PromptTemplate[]
  placeholder?: string
  className?: string
  containerClassName?: string
  multiline?: boolean
  rows?: number
  autoFocus?: boolean
  onBlur?: () => void
  onKeyDown?: (e: React.KeyboardEvent) => void
  'data-testid'?: string
}

export default function PromptMentionInput({
  value,
  onChange,
  prompts,
  placeholder,
  className = '',
  containerClassName = '',
  multiline = false,
  rows = 3,
  autoFocus = false,
  onBlur,
  onKeyDown,
  'data-testid': dataTestId,
}: PromptMentionInputProps) {
  const {
    isOpen,
    filteredPrompts,
    highlightedIndex,
    dropdownPosition,
    inputRef,
    containerRef,
    handleChange,
    handleKeyDown,
    handleBlur,
    handleSelect,
    setHighlightedIndex,
  } = useMentionInput({ value, onChange, prompts, onBlur, onKeyDown })

  const commonProps = {
    ref: inputRef as React.RefObject<HTMLInputElement> & React.RefObject<HTMLTextAreaElement>,
    value,
    onChange: handleChange,
    onKeyDown: handleKeyDown,
    onBlur: handleBlur,
    placeholder,
    autoFocus,
    className,
    'data-testid': dataTestId,
  }

  return (
    <div ref={containerRef} className={`relative ${containerClassName}`}>
      {multiline ? (
        <textarea {...commonProps} rows={rows} />
      ) : (
        <input {...commonProps} type="text" />
      )}

      {isOpen && (
        <PromptDropdown
          prompts={filteredPrompts}
          highlightedIndex={highlightedIndex}
          onSelect={handleSelect}
          onHighlight={setHighlightedIndex}
          position={dropdownPosition}
        />
      )}
    </div>
  )
}
