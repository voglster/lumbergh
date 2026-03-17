import { useState, useCallback } from 'react'
import { getApiBase } from '../../config'

interface CommitResult {
  type: 'success' | 'error'
  message: string
}

interface UseGitActionsOptions {
  sessionName?: string
  onRefresh: () => void
  onGitAction?: () => void
}

function clearAfter(setter: (v: CommitResult | null) => void, ms = 4000) {
  setTimeout(() => setter(null), ms)
}

export function useGitActions({ sessionName, onRefresh, onGitAction }: UseGitActionsOptions) {
  const [commitMessage, setCommitMessage] = useState('')
  const [isCommitting, setIsCommitting] = useState(false)
  const [isPushing, setIsPushing] = useState(false)
  const [isGenerating, setIsGenerating] = useState(false)
  const [isResetting, setIsResetting] = useState(false)
  const [revertingFile, setRevertingFile] = useState<string | null>(null)
  const [commitResult, setCommitResult] = useState<CommitResult | null>(null)
  const [isBranchOp, setIsBranchOp] = useState(false)
  const [isDeletingBranch, setIsDeletingBranch] = useState(false)

  const gitBaseUrl = sessionName
    ? `${getApiBase()}/sessions/${sessionName}/git`
    : `${getApiBase()}/git`

  const generateUrl = sessionName
    ? `${getApiBase()}/sessions/${sessionName}/ai/generate-commit-message`
    : null

  const notifySuccess = useCallback(() => {
    onRefresh()
    onGitAction?.()
  }, [onRefresh, onGitAction])

  const handleReset = useCallback(async () => {
    if (
      !confirm(
        'Revert all changes? This will discard all uncommitted changes and cannot be undone.'
      )
    )
      return

    setIsResetting(true)
    setCommitResult(null)
    try {
      const res = await fetch(`${gitBaseUrl}/reset`, { method: 'POST' })
      const result = await res.json()
      if (!res.ok) {
        setCommitResult({ type: 'error', message: result.detail || 'Reset failed' })
      } else if (result.status === 'nothing_to_reset') {
        setCommitResult({ type: 'error', message: 'Nothing to reset' })
      } else {
        setCommitResult({ type: 'success', message: 'All changes reverted' })
        notifySuccess()
      }
    } catch {
      setCommitResult({ type: 'error', message: 'Failed to reset changes' })
    } finally {
      setIsResetting(false)
      clearAfter(setCommitResult, 3000)
    }
  }, [gitBaseUrl, notifySuccess])

  const handlePush = useCallback(
    async (commitHash: string) => {
      setIsPushing(true)
      setCommitResult({ type: 'success', message: `Committed: ${commitHash} — pushing...` })
      try {
        const pushRes = await fetch(`${gitBaseUrl}/push`, { method: 'POST' })
        if (pushRes.ok) {
          setCommitResult({ type: 'success', message: `Committed & pushed: ${commitHash}` })
          onGitAction?.()
        } else {
          const pushData = await pushRes.json()
          setCommitResult({
            type: 'error',
            message: `Committed but push failed: ${pushData.detail || 'Unknown error'}`,
          })
        }
      } catch {
        setCommitResult({ type: 'error', message: `Committed but push failed: network error` })
      } finally {
        setIsPushing(false)
      }
    },
    [gitBaseUrl, onGitAction]
  )

  const handleCommit = useCallback(
    async (andPush = false) => {
      if (!commitMessage.trim()) return
      setIsCommitting(true)
      setCommitResult(null)
      try {
        const res = await fetch(`${gitBaseUrl}/commit`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ message: commitMessage.trim() }),
        })
        const result = await res.json()
        if (!res.ok) {
          setCommitResult({ type: 'error', message: result.detail || 'Commit failed' })
          return
        }
        if (result.status === 'nothing_to_commit') {
          setCommitResult({ type: 'error', message: 'Nothing to commit' })
          return
        }

        setCommitMessage('')
        notifySuccess()

        if (andPush) {
          await handlePush(result.hash)
        } else {
          setCommitResult({ type: 'success', message: `Committed: ${result.hash}` })
        }
      } catch {
        setCommitResult({ type: 'error', message: 'Failed to commit' })
      } finally {
        setIsCommitting(false)
        clearAfter(setCommitResult)
      }
    },
    [commitMessage, gitBaseUrl, notifySuccess, handlePush]
  )

  const handleGenerate = useCallback(async () => {
    if (!generateUrl) return
    setIsGenerating(true)
    setCommitResult(null)
    try {
      const res = await fetch(generateUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      })
      const result = await res.json()
      if (!res.ok) {
        setCommitResult({ type: 'error', message: result.detail || 'Failed to generate' })
      } else {
        setCommitMessage(result.message)
      }
    } catch {
      setCommitResult({ type: 'error', message: 'Failed to generate commit message' })
    } finally {
      setIsGenerating(false)
      clearAfter(setCommitResult, 3000)
    }
  }, [generateUrl])

  const handleRevertFile = useCallback(
    async (filePath: string, e: React.MouseEvent) => {
      e.stopPropagation()
      if (!confirm(`Revert "${filePath}"? This cannot be undone.`)) return
      setRevertingFile(filePath)
      setCommitResult(null)
      try {
        const res = await fetch(`${gitBaseUrl}/revert-file`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ path: filePath }),
        })
        const result = await res.json()
        if (!res.ok) {
          setCommitResult({ type: 'error', message: result.detail || 'Revert failed' })
        } else {
          setCommitResult({ type: 'success', message: result.message })
          notifySuccess()
        }
      } catch {
        setCommitResult({ type: 'error', message: `Failed to revert ${filePath}` })
      } finally {
        setRevertingFile(null)
        clearAfter(setCommitResult, 3000)
      }
    },
    [gitBaseUrl, notifySuccess]
  )

  const handleMenuAction = useCallback(
    async (action: 'amend' | 'force-push' | 'stash' | 'stash-pop') => {
      if (action === 'force-push') {
        if (!confirm('Force push with --force-with-lease? This will overwrite remote history.'))
          return
      }

      setCommitResult(null)
      try {
        const url = `${gitBaseUrl}/${action}`
        const options: RequestInit = { method: 'POST' }

        if (action === 'amend') {
          options.headers = { 'Content-Type': 'application/json' }
          options.body = JSON.stringify({ message: commitMessage.trim() || null })
        }

        const res = await fetch(url, options)
        const result = await res.json()

        if (!res.ok) {
          setCommitResult({ type: 'error', message: result.detail || `${action} failed` })
        } else {
          const messages: Record<string, string> = {
            amend: `Amended: ${result.hash} — ${result.message}`,
            'force-push': result.message || 'Force pushed',
            stash: 'Changes stashed',
            'stash-pop': 'Stash popped',
          }
          setCommitResult({ type: 'success', message: messages[action] })
          if (action === 'amend') setCommitMessage('')
          notifySuccess()
        }
      } catch {
        setCommitResult({ type: 'error', message: `${action} failed` })
      } finally {
        clearAfter(setCommitResult)
      }
    },
    [gitBaseUrl, commitMessage, notifySuccess]
  )

  const handleBranchAction = useCallback(
    async (targetBranch: string, type: 'rebase' | 'ff') => {
      const isRebase = type === 'rebase'
      const action = isRebase ? 'rebase' : 'fast-forward'
      const label = isRebase ? `Rebase onto ${targetBranch}` : `Fast-forward to ${targetBranch}`

      if (!confirm(`${label}?`)) return

      setIsBranchOp(true)
      setCommitResult(null)
      try {
        const res = await fetch(`${gitBaseUrl}/${action}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch: targetBranch }),
        })
        const result = await res.json()
        if (!res.ok) {
          setCommitResult({ type: 'error', message: result.detail || `${label} failed` })
        } else {
          setCommitResult({
            type: 'success',
            message: result.stashConflict
              ? `${result.message} (stash conflicts — resolve manually)`
              : result.message,
          })
          notifySuccess()
        }
      } catch {
        setCommitResult({ type: 'error', message: `${label} failed` })
      } finally {
        setIsBranchOp(false)
        clearAfter(setCommitResult, 5000)
      }
    },
    [gitBaseUrl, notifySuccess]
  )

  const handleDeleteBranch = useCallback(
    async (branchName: string, deleteRemote: boolean) => {
      const scope = deleteRemote ? 'local and remote' : 'local'
      if (!confirm(`Delete ${scope} branch "${branchName}"? This cannot be undone.`)) return

      setIsDeletingBranch(true)
      setCommitResult(null)
      try {
        const res = await fetch(`${gitBaseUrl}/delete-branch`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ branch: branchName, delete_remote: deleteRemote }),
        })
        const result = await res.json()
        if (!res.ok) {
          setCommitResult({ type: 'error', message: result.detail || 'Delete failed' })
        } else {
          setCommitResult({ type: 'success', message: result.message })
          notifySuccess()
        }
      } catch {
        setCommitResult({ type: 'error', message: `Failed to delete branch ${branchName}` })
      } finally {
        setIsDeletingBranch(false)
        clearAfter(setCommitResult, 3000)
      }
    },
    [gitBaseUrl, notifySuccess]
  )

  return {
    commitMessage,
    setCommitMessage,
    isCommitting,
    isPushing,
    isGenerating,
    isResetting,
    revertingFile,
    commitResult,
    isBranchOp,
    isDeletingBranch,
    gitBaseUrl,
    generateUrl,
    handleReset,
    handleCommit,
    handleGenerate,
    handleRevertFile,
    handleMenuAction,
    handleBranchAction,
    handleDeleteBranch,
  }
}
