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

  for (const match of text.matchAll(MENTION_REGEX)) {
    // Add text before the match
    if (match.index > lastIndex) {
      parts.push(text.slice(lastIndex, match.index))
    }

    const mentionName = match[1]
    const prompt = prompts.find((p) => p.name.toLowerCase() === mentionName.toLowerCase())

    // Style based on whether prompt exists and its scope
    const bgColor = prompt
      ? prompt.scope === 'project'
        ? 'bg-success/10 text-success border-success/50'
        : 'bg-purple/10 text-purple border-purple/50'
      : 'bg-danger/10 text-danger border-danger/50'

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
