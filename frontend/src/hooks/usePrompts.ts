import { useState, useEffect, useCallback } from 'react'
import type { PromptTemplate } from '../utils/promptResolver'

interface UsePromptsResult {
  projectPrompts: PromptTemplate[]
  globalPrompts: PromptTemplate[]
  allPrompts: PromptTemplate[]
  isLoading: boolean
  error: string | null
  refetch: () => void
}

export function usePrompts(apiHost: string, sessionName: string | null): UsePromptsResult {
  const [projectPrompts, setProjectPrompts] = useState<PromptTemplate[]>([])
  const [globalPrompts, setGlobalPrompts] = useState<PromptTemplate[]>([])
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchPrompts = useCallback(async () => {
    if (!sessionName) {
      setIsLoading(false)
      return
    }

    setIsLoading(true)
    setError(null)

    try {
      const [projectRes, globalRes] = await Promise.all([
        fetch(`http://${apiHost}/api/sessions/${sessionName}/prompts`),
        fetch(`http://${apiHost}/api/global/prompts`),
      ])

      if (!projectRes.ok || !globalRes.ok) {
        throw new Error('Failed to fetch prompts')
      }

      const [projectData, globalData] = await Promise.all([
        projectRes.json(),
        globalRes.json(),
      ])

      // Add scope to each prompt for display
      const projectWithScope = (projectData.templates || []).map((p: PromptTemplate) => ({
        ...p,
        scope: 'project' as const,
      }))
      const globalWithScope = (globalData.templates || []).map((p: PromptTemplate) => ({
        ...p,
        scope: 'global' as const,
      }))

      setProjectPrompts(projectWithScope)
      setGlobalPrompts(globalWithScope)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch prompts')
    } finally {
      setIsLoading(false)
    }
  }, [apiHost, sessionName])

  useEffect(() => {
    fetchPrompts()
  }, [fetchPrompts])

  // Combine all prompts, project first
  const allPrompts = [...projectPrompts, ...globalPrompts]

  return {
    projectPrompts,
    globalPrompts,
    allPrompts,
    isLoading,
    error,
    refetch: fetchPrompts,
  }
}
