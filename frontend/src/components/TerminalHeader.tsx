import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Minus,
  Plus,
  MoreHorizontal,
  Eraser,
  Brain,
  ExternalLink,
  RefreshCw,
} from 'lucide-react'
import Button from './ui/Button'
import SessionNavigatorDots from './SessionNavigatorDots'

interface Props {
  sessionName: string
  isConnected: boolean
  fontSize: number
  onFontSizeChange: (size: number) => void
  headerExpanded: boolean
  onHeaderExpandedChange: (expanded: boolean) => void
  isTouchDevice: boolean
  scrollMode: boolean
  onToggleScrollMode: () => void
  onSendRaw: (data: string) => void
  onSendViaApi: (text: string) => void
  onSendTmuxCommand: (command: string) => void
  onFit: () => void
  onBack?: () => void
  onReset?: () => void
  onCycleSession?: (direction: 'next' | 'prev') => void
  showSessionDots?: boolean
  showSummary?: boolean
  onShowSummary?: () => void
}

export default function TerminalHeader({
  sessionName,
  isConnected,
  fontSize,
  onFontSizeChange,
  headerExpanded,
  onHeaderExpandedChange,
  isTouchDevice,
  scrollMode,
  onToggleScrollMode,
  onSendRaw,
  onSendViaApi,
  onSendTmuxCommand,
  onFit,
  onBack,
  onReset,
  onCycleSession,
  showSessionDots = true,
  showSummary = false,
  onShowSummary,
}: Props) {
  return (
    <div className="glass border-b border-border-default">
      {/* Main row */}
      <div className="flex items-center gap-2 p-2">
        <div className="flex items-center gap-2 shrink-0">
          {onBack && (
            <>
              <button
                onClick={onBack}
                className="text-text-tertiary hover:text-text-primary transition-colors"
                title="Back to Dashboard"
              >
                <ArrowLeft size={16} />
              </button>
              <div className="w-px h-4 bg-border-subtle mx-1" />
            </>
          )}
        </div>
        <span
          onClick={onCycleSession ? (e) => onCycleSession(e.shiftKey ? 'prev' : 'next') : undefined}
          className={`shrink-0 flex items-center gap-1 text-sm font-semibold text-text-secondary ${onCycleSession ? 'cursor-pointer group hover:text-text-primary transition-colors' : 'pointer-events-none'}`}
          title={onCycleSession ? 'Click: next session · Shift+click: previous' : undefined}
        >
          {onCycleSession && (
            <span className="opacity-0 group-hover:opacity-40 transition-opacity text-xs shrink-0">
              ‹
            </span>
          )}
          <span className="truncate">{sessionName}</span>
          {onCycleSession && (
            <span className="opacity-0 group-hover:opacity-40 transition-opacity text-xs shrink-0">
              ›
            </span>
          )}
        </span>
        {showSessionDots ? (
          <SessionNavigatorDots currentSessionName={sessionName} />
        ) : (
          <div className="flex-1" />
        )}
        <QuickActions
          sessionName={sessionName}
          isConnected={isConnected}
          isTouchDevice={isTouchDevice}
          scrollMode={scrollMode}
          headerExpanded={headerExpanded}
          showSummary={showSummary}
          onToggleScrollMode={onToggleScrollMode}
          onSendRaw={onSendRaw}
          onSendViaApi={onSendViaApi}
          onHeaderExpandedChange={onHeaderExpandedChange}
          onShowSummary={onShowSummary}
        />
      </div>
      {/* Expanded row */}
      {headerExpanded && (
        <ExpandedRow
          fontSize={fontSize}
          onFontSizeChange={onFontSizeChange}
          isConnected={isConnected}
          isTouchDevice={isTouchDevice}
          onSendRaw={onSendRaw}
          onSendViaApi={onSendViaApi}
          onSendTmuxCommand={onSendTmuxCommand}
          onFit={onFit}
          onReset={onReset}
          onCollapse={() => onHeaderExpandedChange(false)}
        />
      )}
    </div>
  )
}

function QuickActions({
  sessionName,
  isConnected,
  isTouchDevice,
  scrollMode,
  headerExpanded,
  showSummary,
  onToggleScrollMode,
  onSendRaw,
  onSendViaApi,
  onHeaderExpandedChange,
  onShowSummary,
}: {
  sessionName: string
  isConnected: boolean
  isTouchDevice: boolean
  scrollMode: boolean
  headerExpanded: boolean
  showSummary?: boolean
  onToggleScrollMode: () => void
  onSendRaw: (data: string) => void
  onSendViaApi: (text: string) => void
  onHeaderExpandedChange: (expanded: boolean) => void
  onShowSummary?: () => void
}) {
  const popOut = () => {
    window.open(
      `/session/${encodeURIComponent(sessionName)}/term`,
      `lumbergh-term-${sessionName}`,
      'width=900,height=600,menubar=no,toolbar=no,location=no,status=no'
    )
  }
  return (
    <div className="flex items-center gap-2 shrink-0">
      {!isTouchDevice && (
        <button
          onClick={popOut}
          className="w-8 h-8 rounded-[var(--radius-md)] bg-control-bg hover:bg-control-bg-hover flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          title="Pop out terminal to new window"
        >
          <ExternalLink size={14} />
        </button>
      )}
      {onShowSummary && !showSummary && (
        <button
          onClick={onShowSummary}
          className="w-8 h-8 rounded-[var(--radius-md)] bg-control-bg hover:bg-control-bg-hover flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          title="What happened? (AI summary)"
        >
          <Brain size={14} className="text-purple" />
        </button>
      )}
      {isTouchDevice &&
        (scrollMode ? (
          <Button
            variant="warning"
            size="sm"
            onClick={onToggleScrollMode}
            disabled={!isConnected}
            title="Exit scroll mode (q)"
          >
            Exit
          </Button>
        ) : (
          <Button
            variant="secondary"
            size="sm"
            onClick={onToggleScrollMode}
            disabled={!isConnected}
            title="Enter scroll mode (copy-mode)"
          >
            Scroll
          </Button>
        ))}
      <Button
        variant="danger"
        size="sm"
        onClick={() => onSendRaw('\x1b')}
        disabled={!isConnected}
        title="Send Escape key"
      >
        Esc
      </Button>
      <Button
        variant="primary"
        size="sm"
        onClick={() => onSendRaw('\x1b[Z')}
        disabled={!isConnected}
        title="Toggle Plan/Accept Edits mode (Shift+Tab)"
      >
        Mode
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onSendViaApi('1')}
        disabled={!isConnected}
        title="Send 1"
      >
        1
      </Button>
      <Button
        variant="secondary"
        size="sm"
        onClick={() => onSendViaApi('/clear')}
        disabled={!isConnected}
        title="Send /clear"
      >
        <Eraser size={16} />
      </Button>
      <button
        onClick={() => onHeaderExpandedChange(!headerExpanded)}
        className={`w-8 h-8 rounded-[var(--radius-md)] flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors cursor-pointer ${headerExpanded ? 'bg-control-bg-hover' : 'bg-control-bg hover:bg-control-bg-hover'}`}
        title="More options"
      >
        <MoreHorizontal size={16} />
      </button>
    </div>
  )
}

function ExpandedRow({
  fontSize,
  onFontSizeChange,
  isConnected,
  isTouchDevice,
  onSendRaw,
  onSendViaApi,
  onSendTmuxCommand,
  onFit,
  onReset,
  onCollapse,
}: {
  fontSize: number
  onFontSizeChange: (size: number) => void
  isConnected: boolean
  isTouchDevice: boolean
  onSendRaw: (data: string) => void
  onSendViaApi: (text: string) => void
  onSendTmuxCommand: (command: string) => void
  onFit: () => void
  onReset?: () => void
  onCollapse: () => void
}) {
  return (
    <div className="flex items-center justify-between px-2 pb-2 overflow-x-auto scrollbar-hide">
      {/* Font size controls and reset - left aligned */}
      <div className="flex items-center gap-3 shrink-0">
        <div className="flex items-center gap-1">
          <span className="text-xs text-text-tertiary">Font:</span>
          <button
            onClick={() => onFontSizeChange(Math.max(8, fontSize - 1))}
            className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover rounded"
            title="Decrease font size"
          >
            <Minus size={14} />
          </button>
          <span className="text-xs text-text-secondary w-5 text-center">{fontSize}</span>
          <button
            onClick={() => onFontSizeChange(Math.min(24, fontSize + 1))}
            className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover rounded"
            title="Increase font size"
          >
            <Plus size={14} />
          </button>
        </div>
        {onReset && (
          <Button
            variant="warning"
            size="sm"
            onClick={() => {
              if (
                confirm(
                  '⚠️ Reset this session?\n\nThis will:\n• Close ALL tmux windows and terminals\n• Kill any running processes\n• Start a fresh Claude session\n\nAny unsaved work will be lost!'
                )
              ) {
                onReset()
                onCollapse()
              }
            }}
            title="Reset session (close all windows and restart Claude)"
          >
            Reset
          </Button>
        )}
        <button
          onClick={() => window.location.reload()}
          className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover rounded flex items-center gap-1"
          title="Force reload the page (useful if the connection is stuck)"
        >
          <RefreshCw size={14} />
          Reload
        </button>
      </div>
      {/* Quick buttons - right aligned */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="success"
          size="sm"
          onClick={() => {
            onSendTmuxCommand('new-window')
            onCollapse()
          }}
          title="Create new tmux window"
        >
          + Window
        </Button>
        {isTouchDevice && (
          <Button
            variant="warning"
            size="sm"
            onClick={() => {
              onSendRaw('q')
              onCollapse()
            }}
            title="Exit scroll mode (press if stuck in scroll)"
          >
            Exit Scroll
          </Button>
        )}
        <button
          onClick={() => {
            onFit()
            onCollapse()
          }}
          className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover rounded"
          title="Fit terminal to container"
        >
          Fit
        </button>
        <button
          onClick={() => onSendRaw('\x1b[A')}
          disabled={!isConnected}
          className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover disabled:opacity-50 rounded"
          title="Send Up Arrow"
        >
          <ChevronUp size={16} />
        </button>
        <button
          onClick={() => onSendRaw('\x1b[B')}
          disabled={!isConnected}
          className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover disabled:opacity-50 rounded"
          title="Send Down Arrow"
        >
          <ChevronDown size={16} />
        </button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => onSendRaw('\x03')}
          disabled={!isConnected}
          title="Send Ctrl+C (interrupt)"
        >
          ^C
        </Button>
        <Button
          variant="danger"
          size="sm"
          onClick={() => onSendRaw('\x04')}
          disabled={!isConnected}
          title="Send Ctrl+D (EOF)"
        >
          ^D
        </Button>
        {['1', '2', '3', '4', 'yes'].map((text) => (
          <Button
            key={text}
            variant="secondary"
            size="sm"
            onClick={() => {
              onSendViaApi(text)
              onCollapse()
            }}
            disabled={!isConnected}
          >
            {text}
          </Button>
        ))}
      </div>
    </div>
  )
}
