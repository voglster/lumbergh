import { useEffect } from 'react'
import { X, Brain, RefreshCw } from 'lucide-react'
import MarkdownPreview from '@uiw/react-markdown-preview'
import { useSessionSummary } from '../hooks/useSessionSummary'
import { useTheme } from '../hooks/useTheme'

interface Props {
  sessionName: string
  onDismiss: () => void
  onTempHide: () => void
}

function SummaryBody({ summary, theme }: { summary: string; theme: 'dark' | 'light' }) {
  return (
    <MarkdownPreview
      source={summary}
      style={{
        backgroundColor: 'transparent',
        color: theme === 'dark' ? '#e5e7eb' : '#073642',
        fontSize: '0.8125rem',
        lineHeight: '1.5',
      }}
      wrapperElement={{
        'data-color-mode': theme,
      }}
    />
  )
}

function LoadingSkeleton() {
  return (
    <div className="space-y-2">
      <div className="h-3 bg-white/10 rounded animate-pulse w-3/4" />
      <div className="h-3 bg-white/10 rounded animate-pulse w-1/2" />
      <div className="h-3 bg-white/10 rounded animate-pulse w-2/3" />
    </div>
  )
}

export default function SessionSummaryOverlay({ sessionName, onDismiss, onTempHide }: Props) {
  const { summary, available, isLoading, generatedAt, provider, model, regenerate } =
    useSessionSummary(sessionName)
  const { theme } = useTheme()

  // Auto-hide when user starts typing (any keypress except modifier keys)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (['Shift', 'Control', 'Alt', 'Meta'].includes(e.key)) return
      onTempHide()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [onTempHide])

  if (!isLoading && !available) return null
  if (!isLoading && !summary) return null

  const timeAgo = generatedAt ? formatTimeAgo(generatedAt) : ''
  const modelLabel = model || provider || ''

  return (
    <div className="absolute inset-0 z-10 flex items-center justify-center pointer-events-none">
      <div className="pointer-events-auto w-[90%] max-w-lg rounded-lg border border-border-default bg-bg-surface/95 backdrop-blur-sm shadow-lg max-h-[70%] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-4 pt-3 pb-1">
          <span className="text-xs text-text-muted font-medium flex items-center gap-1.5">
            <Brain size={12} className="text-purple-400" />
            What happened?{timeAgo ? ` · ${timeAgo}` : ''}
          </span>
          <div className="flex items-center gap-1">
            <button
              onClick={regenerate}
              disabled={isLoading}
              className="text-text-muted hover:text-text-secondary transition-colors p-0.5 disabled:opacity-50"
              title="Regenerate summary"
            >
              <RefreshCw size={12} className={isLoading ? 'animate-spin' : ''} />
            </button>
            <button
              onClick={onTempHide}
              className="text-text-muted hover:text-text-secondary transition-colors p-0.5"
              title="Close"
            >
              <X size={14} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="px-4 pb-3">
          {isLoading ? <LoadingSkeleton /> : <SummaryBody summary={summary} theme={theme} />}
        </div>

        {/* Footer — model info + dismiss link */}
        {!isLoading && (
          <div className="px-4 pb-3 pt-0 flex items-center justify-between">
            {modelLabel && <span className="text-[10px] text-text-muted">{modelLabel}</span>}
            <button
              onClick={onDismiss}
              className="text-[10px] text-text-muted hover:text-text-secondary transition-colors"
            >
              never show this again
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function formatTimeAgo(isoString: string): string {
  const diff = Date.now() - new Date(isoString).getTime()
  const minutes = Math.floor(diff / 60_000)
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}
