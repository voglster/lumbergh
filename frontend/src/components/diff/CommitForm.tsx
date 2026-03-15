import { useState, useEffect, useRef, memo } from 'react'
import { MoreHorizontal } from 'lucide-react'
import { getApiBase } from '../../config'

interface Props {
  commitMessage: string
  onCommitMessageChange: (msg: string) => void
  hasChanges: boolean
  isCommitting: boolean
  isPushing: boolean
  isGenerating: boolean
  isResetting: boolean
  commitResult: { type: 'success' | 'error'; message: string } | null
  generateUrl: string | null
  onCommit: (andPush?: boolean) => void
  onGenerate: () => void
  onMenuAction: (action: 'amend' | 'force-push' | 'stash' | 'stash-pop') => void
}

function GitActionsMenu({
  onAction,
}: {
  onAction: (action: 'amend' | 'force-push' | 'stash' | 'stash-pop') => void
}) {
  return (
    <div className="absolute top-full right-0 mt-1 w-48 bg-bg-surface border border-border-default rounded shadow-lg z-50">
      <button
        onClick={() => onAction('amend')}
        className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-control-bg-hover transition-colors"
      >
        Amend last commit
      </button>
      <button
        onClick={() => onAction('force-push')}
        className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-control-bg-hover transition-colors"
      >
        Force push (lease)
      </button>
      <div className="border-t border-border-default" />
      <button
        onClick={() => onAction('stash')}
        className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-control-bg-hover transition-colors"
      >
        Stash changes
      </button>
      <button
        onClick={() => onAction('stash-pop')}
        className="w-full text-left px-3 py-2 text-sm text-text-secondary hover:bg-control-bg-hover transition-colors"
      >
        Pop stash
      </button>
    </div>
  )
}

const CommitForm = memo(function CommitForm({
  commitMessage,
  onCommitMessageChange,
  hasChanges,
  isCommitting,
  isPushing,
  isGenerating,
  isResetting,
  commitResult,
  generateUrl,
  onCommit,
  onGenerate,
  onMenuAction,
}: Props) {
  const [showMenu, setShowMenu] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const menuBtnRef = useRef<HTMLButtonElement>(null)
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null)

  // Close menu on click outside
  useEffect(() => {
    if (!showMenu) return
    const handleClick = (e: MouseEvent) => {
      if (
        menuRef.current &&
        !menuRef.current.contains(e.target as Node) &&
        menuBtnRef.current &&
        !menuBtnRef.current.contains(e.target as Node)
      ) {
        setShowMenu(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showMenu])

  // Check if AI is configured
  useEffect(() => {
    if (!generateUrl) return
    fetch(`${getApiBase()}/settings`)
      .then((res) => res.json())
      .then((data) => setAiConfigured(data.aiConfigured ?? false))
      .catch(() => setAiConfigured(false))
  }, [generateUrl])

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (!commitMessage.trim()) return
    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey) && e.shiftKey) {
      e.preventDefault()
      onCommit(true)
    } else if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
      e.preventDefault()
      onCommit(false)
    }
  }

  const handleMenuAction = (action: 'amend' | 'force-push' | 'stash' | 'stash-pop') => {
    setShowMenu(false)
    onMenuAction(action)
  }

  const busy = isCommitting || isPushing || isGenerating || isResetting

  return (
    <div className="p-3 bg-bg-surface border-b border-border-default">
      <div className="flex gap-2">
        <textarea
          value={commitMessage}
          onChange={(e) => onCommitMessageChange(e.target.value)}
          onKeyDown={handleKeyDown}
          placeholder="Commit message..."
          rows={commitMessage.includes('\n') ? 3 : 1}
          className="flex-1 px-3 py-2 bg-control-bg text-text-primary text-sm rounded border border-border-subtle focus:outline-none focus:border-blue-500 resize-none"
          disabled={isCommitting || isGenerating}
        />
        <div className="flex flex-col gap-1.5 shrink-0">
          <button
            onClick={() => onCommit(true)}
            disabled={!commitMessage.trim() || busy}
            data-testid="commit-btn"
            className="px-3 py-2 bg-green-600 hover:bg-green-500 disabled:bg-control-bg-hover disabled:cursor-not-allowed text-text-primary text-sm rounded transition-colors"
            title="Commit & push (Ctrl/Cmd+Shift+Enter)"
          >
            {isCommitting ? 'Committing...' : isPushing ? 'Pushing...' : 'Commit & Push'}
          </button>
          <div className="relative flex gap-1">
            <button
              onClick={() => onCommit(false)}
              disabled={!commitMessage.trim() || busy}
              className="flex-1 px-2 py-1 text-text-tertiary hover:text-text-secondary disabled:text-text-muted disabled:cursor-not-allowed text-xs transition-colors"
              title="Commit only (Ctrl/Cmd+Enter)"
            >
              Commit
            </button>
            <button
              ref={menuBtnRef}
              onClick={() => setShowMenu((v) => !v)}
              disabled={isCommitting || isPushing || isResetting}
              className="px-1.5 py-1 text-text-tertiary hover:text-text-secondary disabled:text-text-muted disabled:cursor-not-allowed text-xs transition-colors"
              title="More git actions"
            >
              <MoreHorizontal size={16} />
            </button>
            {showMenu && (
              <div ref={menuRef}>
                <GitActionsMenu onAction={handleMenuAction} />
              </div>
            )}
          </div>
          {generateUrl && hasChanges && (
            <button
              onClick={aiConfigured ? onGenerate : undefined}
              disabled={!aiConfigured || busy}
              className={`px-3 py-2 text-sm rounded transition-colors ${
                aiConfigured
                  ? 'bg-purple-600 hover:bg-purple-500 disabled:bg-control-bg-hover disabled:cursor-not-allowed text-text-primary'
                  : 'bg-control-bg-hover text-text-muted cursor-not-allowed'
              }`}
              title={
                aiConfigured
                  ? 'Generate commit message with AI'
                  : 'Configure an AI provider in Settings to enable this'
              }
            >
              {isGenerating ? '...' : 'AI'}
            </button>
          )}
        </div>
      </div>
      {commitResult && (
        <div
          className={`mt-2 text-sm ${commitResult.type === 'success' ? 'text-green-400' : 'text-red-400'}`}
        >
          {commitResult.message}
        </div>
      )}
    </div>
  )
})

export default CommitForm
