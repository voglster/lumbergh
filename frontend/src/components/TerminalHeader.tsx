import {
  ArrowLeft,
  ChevronUp,
  ChevronDown,
  Minus,
  Plus,
  MoreHorizontal,
  Eraser,
} from 'lucide-react'

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
}: Props) {
  return (
    <div className="bg-bg-surface border-b border-border-default">
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
          className={`flex-1 min-w-0 flex items-center gap-1 text-sm font-semibold text-text-secondary ${onCycleSession ? 'cursor-pointer group hover:text-text-primary transition-colors' : 'pointer-events-none'}`}
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
        <div className="flex items-center gap-2 shrink-0">
          {isTouchDevice && (
            <button
              onClick={onToggleScrollMode}
              disabled={!isConnected}
              className={`px-2 py-1 text-xs rounded ${
                scrollMode
                  ? 'bg-yellow-600 hover:bg-yellow-500'
                  : 'bg-control-bg hover:bg-control-bg-hover'
              } disabled:bg-control-bg-hover disabled:opacity-50`}
              title={scrollMode ? 'Exit scroll mode (q)' : 'Enter scroll mode (copy-mode)'}
            >
              {scrollMode ? 'Exit' : 'Scroll'}
            </button>
          )}
          <button
            onClick={() => onSendRaw('\x1b')}
            disabled={!isConnected}
            className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 disabled:bg-control-bg-hover disabled:opacity-50 rounded"
            title="Send Escape key"
          >
            Esc
          </button>
          <button
            onClick={() => onSendRaw('\x1b[Z')}
            disabled={!isConnected}
            className="px-2 py-1 text-xs bg-blue-700 hover:bg-blue-600 disabled:bg-control-bg-hover disabled:opacity-50 rounded"
            title="Toggle Plan/Accept Edits mode (Shift+Tab)"
          >
            Mode
          </button>
          <button
            onClick={() => onSendViaApi('1')}
            disabled={!isConnected}
            className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover disabled:opacity-50 rounded"
            title="Send 1"
          >
            1
          </button>
          <button
            onClick={() => onSendViaApi('/clear')}
            disabled={!isConnected}
            className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover disabled:opacity-50 rounded"
            title="Send /clear"
          >
            <Eraser size={16} />
          </button>
          <button
            onClick={() => onHeaderExpandedChange(!headerExpanded)}
            className={`px-2 py-1 text-xs rounded ${headerExpanded ? 'bg-control-bg-hover' : 'bg-control-bg hover:bg-control-bg-hover'}`}
            title="More options"
          >
            <MoreHorizontal size={16} />
          </button>
        </div>
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
          <button
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
            className="px-2 py-1 text-xs bg-yellow-700 hover:bg-yellow-600 rounded"
            title="Reset session (close all windows and restart Claude)"
          >
            Reset
          </button>
        )}
      </div>
      {/* Quick buttons - right aligned */}
      <div className="flex items-center gap-2 shrink-0">
        <button
          onClick={() => {
            onSendTmuxCommand('new-window')
            onCollapse()
          }}
          className="px-2 py-1 text-xs bg-green-700 hover:bg-green-600 rounded"
          title="Create new tmux window"
        >
          + Window
        </button>
        {isTouchDevice && (
          <button
            onClick={() => {
              onSendRaw('q')
              onCollapse()
            }}
            className="px-2 py-1 text-xs bg-yellow-600 hover:bg-yellow-500 rounded"
            title="Exit scroll mode (press if stuck in scroll)"
          >
            Exit Scroll
          </button>
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
        <button
          onClick={() => onSendRaw('\x03')}
          disabled={!isConnected}
          className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded"
          title="Send Ctrl+C (interrupt)"
        >
          ^C
        </button>
        <button
          onClick={() => onSendRaw('\x04')}
          disabled={!isConnected}
          className="px-2 py-1 text-xs bg-red-700 hover:bg-red-600 disabled:opacity-50 rounded"
          title="Send Ctrl+D (EOF)"
        >
          ^D
        </button>
        {['1', '2', '3', '4', 'yes'].map((text) => (
          <button
            key={text}
            onClick={() => {
              onSendViaApi(text)
              onCollapse()
            }}
            disabled={!isConnected}
            className="px-2 py-1 text-xs bg-control-bg hover:bg-control-bg-hover disabled:opacity-50 rounded"
          >
            {text}
          </button>
        ))}
      </div>
    </div>
  )
}
