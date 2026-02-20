import { useEffect, useRef } from 'react'
import type { PromptTemplate } from '../utils/promptResolver'

interface PromptDropdownProps {
  prompts: PromptTemplate[]
  highlightedIndex: number
  onSelect: (prompt: PromptTemplate) => void
  onHighlight: (index: number) => void
  position: { top: number; left: number }
}

export default function PromptDropdown({
  prompts,
  highlightedIndex,
  onSelect,
  onHighlight,
  position,
}: PromptDropdownProps) {
  const dropdownRef = useRef<HTMLDivElement>(null)
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([])

  // Scroll highlighted item into view
  useEffect(() => {
    const item = itemRefs.current[highlightedIndex]
    if (item) {
      item.scrollIntoView({ block: 'nearest' })
    }
  }, [highlightedIndex])

  if (prompts.length === 0) {
    return null
  }

  return (
    <div
      ref={dropdownRef}
      className="fixed z-50 bg-gray-700 border border-gray-600 rounded shadow-lg max-h-48 overflow-y-auto min-w-[200px]"
      style={{
        top: position.top,
        left: position.left,
      }}
    >
      {prompts.map((prompt, index) => (
        <button
          key={prompt.id}
          ref={(el) => {
            itemRefs.current[index] = el
          }}
          type="button"
          onClick={() => onSelect(prompt)}
          onMouseEnter={() => onHighlight(index)}
          className={`w-full px-3 py-2 text-left transition-colors flex items-center gap-2 ${
            index === highlightedIndex
              ? 'bg-blue-600 text-white'
              : 'text-white hover:bg-gray-600'
          }`}
        >
          <span className="flex-1 truncate">{prompt.name}</span>
          <span
            className={`text-xs px-1.5 py-0.5 rounded ${
              index === highlightedIndex
                ? 'bg-blue-700 text-blue-200'
                : prompt.scope === 'project'
                ? 'bg-green-900 text-green-300'
                : 'bg-purple-900 text-purple-300'
            }`}
          >
            {prompt.scope === 'project' ? 'P' : 'G'}
          </span>
        </button>
      ))}
    </div>
  )
}
