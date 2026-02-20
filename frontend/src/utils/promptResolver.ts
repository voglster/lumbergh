export interface PromptTemplate {
  id: string
  name: string
  prompt: string
  scope?: 'project' | 'global'
}

const MENTION_REGEX = /@([a-zA-Z0-9_-]+)/g

/**
 * Find all @promptName references in text
 */
export function findPromptReferences(text: string): string[] {
  const matches = text.match(MENTION_REGEX)
  if (!matches) return []
  // Extract just the names (without @)
  return matches.map((m) => m.slice(1))
}

/**
 * Expand all @promptName references to their prompt content
 * If a prompt is not found, leaves the @name as-is
 */
export function expandPromptReferences(text: string, prompts: PromptTemplate[]): string {
  return text.replace(MENTION_REGEX, (match, name) => {
    const prompt = prompts.find(
      (p) => p.name.toLowerCase() === name.toLowerCase()
    )
    return prompt ? prompt.prompt : match
  })
}

/**
 * Check if any @references in text are missing (not found in prompts)
 */
export function findMissingReferences(text: string, prompts: PromptTemplate[]): string[] {
  const refs = findPromptReferences(text)
  return refs.filter(
    (name) => !prompts.some((p) => p.name.toLowerCase() === name.toLowerCase())
  )
}

/**
 * Filter prompts by partial name match (case-insensitive)
 */
export function filterPromptsByQuery(prompts: PromptTemplate[], query: string): PromptTemplate[] {
  const lowerQuery = query.toLowerCase()
  return prompts.filter((p) => p.name.toLowerCase().includes(lowerQuery))
}

/**
 * Find a @mention that ends at the given cursor position
 * Returns { start, end, name } or null if no mention ends at cursor
 */
export function findMentionEndingAt(
  text: string,
  cursorPos: number
): { start: number; end: number; name: string } | null {
  // Look backwards from cursor for a complete @mention
  // The cursor should be right after the mention (no space between)
  const regex = /@([a-zA-Z0-9_-]+)/g
  let match: RegExpExecArray | null

  while ((match = regex.exec(text)) !== null) {
    const start = match.index
    const end = start + match[0].length
    // Check if this mention ends exactly at cursor position
    if (end === cursorPos) {
      return { start, end, name: match[1] }
    }
  }

  return null
}
