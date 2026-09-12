import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Minus,
  Plus,
  MoreHorizontal,
  Eraser,
  ExternalLink,
  RefreshCw,
  MessageSquare,
  SquareTerminal,
  GitBranchPlus,
  Split,
  Zap,
  CheckCheck,
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
  onSendRaw: (data: string) => void
  onSendViaApi: (text: string) => void
  onSendTmuxCommand: (command: string) => void
  onInterrupt: () => void
  onFit: () => void
  onBack?: () => void
  onSpawnSession?: () => void
  onQuickWorktree?: () => void
  onForkSession?: () => void
  onReset?: () => void
  onDone?: () => void
  onCycleSession?: (direction: 'next' | 'prev') => void
  showSessionDots?: boolean
  view: 'term' | 'conv'
  onToggleView: () => void
  scale: number
  onScaleChange: (scale: number) => void
}

export default function TerminalHeader({
  sessionName,
  isConnected,
  fontSize,
  onFontSizeChange,
  headerExpanded,
  onHeaderExpandedChange,
  isTouchDevice,
  onSendRaw,
  onSendViaApi,
  onSendTmuxCommand,
  onInterrupt,
  onFit,
  onBack,
  onReset,
  onDone,
  onCycleSession,
  showSessionDots = true,
  view,
  onToggleView,
  scale,
  onScaleChange,
  onSpawnSession,
  onQuickWorktree,
  onForkSession,
}: Props) {
  return (
    <div className="glass border-b border-border-default">
      {/* Main row */}
      <div className="flex items-center gap-2 p-2 overflow-x-auto overflow-y-hidden scrollbar-hide">
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
        {onDone && (
          <button
            onClick={onDone}
            className="shrink-0 px-2 py-1 text-xs rounded flex items-center gap-1 bg-control-bg hover:bg-danger/20 hover:text-danger text-text-tertiary transition-colors"
            title="Finish with this session: close it and return to where you spawned it from"
          >
            <CheckCheck size={14} />
            Done
          </button>
        )}
        <QuickActions
          sessionName={sessionName}
          isConnected={isConnected}
          isTouchDevice={isTouchDevice}
          headerExpanded={headerExpanded}
          onSendViaApi={onSendViaApi}
          onInterrupt={onInterrupt}
          onHeaderExpandedChange={onHeaderExpandedChange}
          view={view}
          onToggleView={onToggleView}
        />
      </div>
      {/* Expanded row */}
      {headerExpanded && (
        <ExpandedRow
          view={view}
          fontSize={fontSize}
          onFontSizeChange={onFontSizeChange}
          scale={scale}
          onScaleChange={onScaleChange}
          isConnected={isConnected}
          onSendRaw={onSendRaw}
          onSendViaApi={onSendViaApi}
          onSendTmuxCommand={onSendTmuxCommand}
          onFit={onFit}
          onReset={onReset}
          onSpawnSession={onSpawnSession}
          onQuickWorktree={onQuickWorktree}
          onForkSession={onForkSession}
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
  headerExpanded,
  onSendViaApi,
  onInterrupt,
  onHeaderExpandedChange,
  view,
  onToggleView,
}: {
  sessionName: string
  isConnected: boolean
  isTouchDevice: boolean
  headerExpanded: boolean
  onSendViaApi: (text: string) => void
  onInterrupt: () => void
  onHeaderExpandedChange: (expanded: boolean) => void
  view: 'term' | 'conv'
  onToggleView: () => void
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
      <button
        onClick={onToggleView}
        data-testid="view-toggle"
        className="w-8 h-8 rounded-[var(--radius-md)] bg-control-bg hover:bg-control-bg-hover flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
        title={view === 'term' ? 'Switch to Conv (Alt+V)' : 'Switch to Term (Alt+V)'}
      >
        {view === 'term' ? <MessageSquare size={14} /> : <SquareTerminal size={14} />}
      </button>
      {!isTouchDevice && (
        <button
          onClick={popOut}
          className="w-8 h-8 rounded-[var(--radius-md)] bg-control-bg hover:bg-control-bg-hover flex items-center justify-center text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          title="Pop out terminal to new window"
        >
          <ExternalLink size={14} />
        </button>
      )}
      <Button
        variant="danger"
        size="icon"
        onClick={onInterrupt}
        data-testid="interrupt-btn"
        title="Stop the agent (Escape)"
      >
        <span className="text-xs">Esc</span>
      </Button>
      <Button
        variant="ghost"
        size="icon"
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
  view,
  fontSize,
  onFontSizeChange,
  scale,
  onScaleChange,
  isConnected,
  onSendRaw,
  onSendViaApi,
  onSendTmuxCommand,
  onFit,
  onReset,
  onSpawnSession,
  onQuickWorktree,
  onForkSession,
  onCollapse,
}: {
  view: 'term' | 'conv'
  fontSize: number
  onFontSizeChange: (size: number) => void
  scale: number
  onScaleChange: (scale: number) => void
  isConnected: boolean
  onSendRaw: (data: string) => void
  onSendViaApi: (text: string) => void
  onSendTmuxCommand: (command: string) => void
  onFit: () => void
  onReset?: () => void
  onSpawnSession?: () => void
  onQuickWorktree?: () => void
  onForkSession?: () => void
  onCollapse: () => void
}) {
  const isConv = view === 'conv'
  return (
    <div className="flex items-center gap-2 px-2 pb-2 overflow-x-auto overflow-y-hidden scrollbar-hide">
      {/* Font/zoom controls and reset - left aligned */}
      <div className="flex items-center gap-3 shrink-0">
        {isConv ? (
          <div className="flex items-center gap-1">
            <span className="text-xs text-text-tertiary">Zoom:</span>
            <button
              onClick={() => onScaleChange(Math.max(0.6, Math.round((scale - 0.1) * 10) / 10))}
              className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover rounded"
              title="Decrease zoom"
            >
              <Minus size={14} />
            </button>
            <span className="text-xs text-text-secondary w-9 text-center">
              {Math.round(scale * 100)}%
            </span>
            <button
              onClick={() => onScaleChange(Math.min(2, Math.round((scale + 0.1) * 10) / 10))}
              className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover rounded"
              title="Increase zoom"
            >
              <Plus size={14} />
            </button>
          </div>
        ) : (
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
        )}
        {onReset && (
          <Button
            variant="warning"
            size="sm"
            onClick={() => {
              if (
                confirm(
                  '⚠️ Reset this session?\n\nThis will:\n• Close ALL tmux windows and terminals\n• Kill any running processes\n• Start a fresh agent session\n\nAny unsaved work will be lost!'
                )
              ) {
                onReset()
                onCollapse()
              }
            }}
            title="Reset session (close all windows and restart the agent)"
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
      {/* Spacer: pushes groups apart when there's room, collapses when content overflows */}
      <div className="flex-1 min-w-0" />
      {/* Quick buttons - right aligned */}
      <div className="flex items-center gap-2 shrink-0">
        <Button
          variant="secondary"
          size="sm"
          onClick={() => {
            onSendRaw('\x1b[Z')
          }}
          disabled={!isConnected}
          title="Toggle Plan/Accept Edits mode (Shift+Tab)"
        >
          Mode
        </Button>
        {onQuickWorktree && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onQuickWorktree()
              onCollapse()
            }}
            title="Quick worktree — a fresh branch and a fresh agent on this repo, nothing to fill in"
            data-testid="quick-worktree"
          >
            <Zap size={14} />
            Quick
          </Button>
        )}
        {onSpawnSession && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onSpawnSession()
              onCollapse()
            }}
            title="New session from this repo"
            data-testid="spawn-session"
          >
            <GitBranchPlus size={14} />
            New
          </Button>
        )}
        {onForkSession && (
          <Button
            variant="secondary"
            size="sm"
            onClick={() => {
              onForkSession()
              onCollapse()
            }}
            title="Fork this session — a new agent that starts from this conversation"
            data-testid="fork-session"
          >
            <Split size={14} />
            Fork
          </Button>
        )}
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
        {!isConv && (
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
        )}
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
