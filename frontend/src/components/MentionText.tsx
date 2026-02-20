import type { ReactNode } from 'react'
import type { PromptTemplate } from '../utils/promptResolver'

interface MentionTextProps {
  text: string
  prompts: PromptTemplate[]
  className?: string
}

const MENTION_REGEX = /@([a-zA-Z0-9_-]+)/g

/**
 * Renders text with @mentions styled as pills
 */
export default function MentionText({ text, prompts, className = '' }: MentionTextProps) {
  const parts: ReactNode[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  // Reset regex state
  MENTION_REGEX.lastIndex = 0

  while ((match = MENTION_REGEX.exec(text)) !== null) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const mentionName = match[1]
    const prompt = prompts.find(
      (p) => p.name.toLowerCase() === mentionName.toLowerCase()
    )

    // Style based on whether prompt exists and its scope
    const bgColor = prompt
      ? prompt.scope === 'project'
        ? 'bg-green-900/50 text-green-300 border-green-700'
        : 'bg-purple-900/50 text-purple-300 border-purple-700'
      : 'bg-red-900/50 text-red-300 border-red-700'

    parts.push(
      <span
        key={match.index}
        className={`inline-flex items-center px-1.5 py-0.5 mx-0.5 rounded border text-xs font-medium ${bgColor}`}
        title={prompt ? `${prompt.scope}: ${prompt.prompt.slice(0, 100)}...` : 'Prompt not found'}
      >
        @{mentionName}
      </span>
    )

    lastIndex = match.index + match[0].length
  }

  // Add remaining text
  if (lastIndex < text.length) {
    parts.push(text.slice(lastIndex))
  }

  return <span className={className}>{parts}</span>
}
