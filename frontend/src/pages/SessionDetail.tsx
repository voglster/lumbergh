import { useState, useEffect, useRef, useCallback, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import {
  ArrowLeft,
  ChevronsLeft,
  ChevronsRight,
  Folder,
  GitBranch,
  ListTodo,
  Maximize2,
  MessageSquareText,
  Minimize2,
  Settings,
  Share2,
  SquareTerminal,
} from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { getApiBase } from '../config'
import Terminal from '../components/Terminal'
import FileBrowser from '../components/FileBrowser'
import ResizablePanes from '../components/ResizablePanes'
import VerticalResizablePanes from '../components/VerticalResizablePanes'
import TodoList from '../components/TodoList'
import Scratchpad from '../components/Scratchpad'
import PromptTemplates from '../components/PromptTemplates'
import SharedFiles from '../components/SharedFiles'
import TelemetryOptIn from '../components/TelemetryOptIn'
import CreateSessionModal from '../components/CreateSessionModal'
import { spawnParentRepo } from '../utils/spawnFrom'
import { parseDiffPayload } from '../utils/diffPayload'
import { errorDetail } from '../utils/apiError'
import ErrorBoundary from '../components/ErrorBoundary'
import ScratchPromoteBanner from '../components/ScratchPromoteBanner'
import GitTab from '../components/graph/GitTab'
import SessionNavigatorDots from '../components/SessionNavigatorDots'
import { useIsDesktop } from '../hooks/useMediaQuery'
import { useSessionSwitchKeys } from '../hooks/useSessionSwitchKeys'
import { useSessionView } from '../hooks/useSessionView'
import { useConversationScale } from '../hooks/useConversationScale'
import ZenTerminal from '../components/ZenTerminal'
import { useFocusMode } from '../hooks/useFocusMode'
import { paneLayout } from '../utils/focusMode'
import type { FocusTarget } from '../utils/focusMode'

type RightPanel = 'git' | 'files' | 'todos' | 'prompts' | 'shared'
type MobileTab = 'terminal' | 'git' | 'files' | 'todos' | 'prompts' | 'shared'

type DiffData = {
  files: Array<{ path: string; diff: string }>
  stats: { additions: number; deletions: number }
}

type TabVisibility = Record<string, boolean>

const ALL_TABS: { id: RightPanel; label: string; Icon: LucideIcon }[] = [
  { id: 'git', label: 'Git', Icon: GitBranch },
  { id: 'files', label: 'Files', Icon: Folder },
  { id: 'todos', label: 'Todo', Icon: ListTodo },
  { id: 'prompts', label: 'Prompts', Icon: MessageSquareText },
  { id: 'shared', label: 'Shared', Icon: Share2 },
]

const DEFAULT_TAB_VISIBILITY: TabVisibility = {
  git: true,
  files: true,
  todos: true,
  prompts: true,
  shared: true,
}

// Compare diff data to avoid unnecessary re-renders
const PANEL_LABELS: Record<string, string> = {
  git: 'The git view',
  files: 'The file browser',
  todos: 'The todo panel',
  prompts: 'The prompts panel',
  shared: 'The shared files panel',
}

function panelLabel(panel: string): string {
  return PANEL_LABELS[panel] ?? 'This panel'
}

// The quick "hide side panels" toggle only steps in when focus/maximize state
// leaves the layout's own collapse unset -- once either forces a side, this
// toggle has nothing to add.
function resolveCollapse(
  layoutCollapse: 'left' | 'right' | null,
  rightPaneCollapsed: boolean
): 'left' | 'right' | null {
  if (layoutCollapse) return layoutCollapse
  return rightPaneCollapsed ? 'right' : null
}

function canQuickCollapse(maximized: boolean, isTerminalOnly: boolean): boolean {
  return !maximized && !isTerminalOnly
}

function canQuickRestore(
  isTerminalOnly: boolean,
  rightPaneCollapsed: boolean,
  focus: FocusTarget,
  maximized: boolean
): boolean {
  return !isTerminalOnly && rightPaneCollapsed && focus !== 'main' && !maximized
}

function diffDataEquals(a: DiffData | null, b: DiffData | null): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.stats.additions !== b.stats.additions || a.stats.deletions !== b.stats.deletions) {
    return false
  }
  if (a.files.length !== b.files.length) return false
  for (let i = 0; i < a.files.length; i++) {
    if (a.files[i].path !== b.files[i].path || a.files[i].diff !== b.files[i].diff) {
      return false
    }
  }
  return true
}

export default function SessionDetail() {
  const { name } = useParams<{ name: string }>()
  const navigate = useNavigate()
  const isDesktop = useIsDesktop()
  useSessionSwitchKeys(name)
  const { focus, setFocus, togglePanel } = useFocusMode()
  const { view, toggleView } = useSessionView()
  const { scale, setScale } = useConversationScale()

  const [notFound, setNotFound] = useState(false)
  const [countdown, setCountdown] = useState(5)

  const [rightPanel, setRightPanel] = useState<RightPanel>(() => {
    const saved = localStorage.getItem('lumbergh:rightPanel')
    if (
      saved === 'git' ||
      saved === 'files' ||
      saved === 'todos' ||
      saved === 'prompts' ||
      saved === 'shared'
    ) {
      return saved
    }
    // Migrate old 'diff' or 'graph' to 'git'
    if (saved === 'diff' || saved === 'graph') return 'git'
    return 'git'
  })
  const [sharedRefreshTrigger, setSharedRefreshTrigger] = useState(0)
  const [gitTabResetTrigger, setGitTabResetTrigger] = useState(0)
  const [mobileTab, setMobileTab] = useState<MobileTab>('terminal')
  // Which pane the maximized view is showing. Only meaningful while focus is
  // 'panel'; it always resets to the panel on the way out of full screen.
  const [fullPane, setFullPane] = useState<'panel' | 'terminal'>('panel')
  const [diffData, setDiffData] = useState<DiffData | null>(null)
  const [diffError, setDiffError] = useState<string | null>(null)
  const [showTelemetryOptIn, setShowTelemetryOptIn] = useState(false)
  const [showSessionDots, setShowSessionDots] = useState(true)
  const [globalTabVisibility, setGlobalTabVisibility] =
    useState<TabVisibility>(DEFAULT_TAB_VISIBILITY)
  const [sessionTabVisibility, setSessionTabVisibility] = useState<TabVisibility | null>(null)
  const [showTabSettings, setShowTabSettings] = useState(false)
  const [isScratch, setIsScratch] = useState(false)
  const [sessionRepo, setSessionRepo] = useState('')
  const [spawnFromRepo, setSpawnFromRepo] = useState<string | null>(null)
  const [forkFrom, setForkFrom] = useState<string | null>(null)
  const [spawningQuick, setSpawningQuick] = useState(false)
  const tabSettingsRef = useRef<HTMLDivElement>(null)
  const focusFnRef = useRef<(() => void) | null>(null)

  // Touch session to track last used time + check existence
  useEffect(() => {
    if (name) {
      fetch(`${getApiBase()}/sessions/${name}/touch`, { method: 'POST' })
        .then((res) => {
          if (res.status === 404) setNotFound(true)
        })
        .catch(() => {})
    }
  }, [name])

  // Fetch settings (telemetry consent + tab visibility)
  useEffect(() => {
    fetch(`${getApiBase()}/settings`)
      .then((res) => res.json())
      .then((data) => {
        if (data.telemetryConsent == null) setShowTelemetryOptIn(true)
        if (data.tabVisibility) setGlobalTabVisibility(data.tabVisibility)
        if (data.showSessionDots != null) setShowSessionDots(data.showSessionDots)
      })
      .catch(() => {})
  }, [])

  // Fetch session metadata for per-session tab visibility
  useEffect(() => {
    if (!name) return
    fetch(`${getApiBase()}/sessions`)
      .then((res) => res.json())
      .then((data) => {
        const session = (data.sessions || []).find((s: { name: string }) => s.name === name)
        if (session) {
          setSessionTabVisibility(session.tabVisibility || null)
          setIsScratch(session.type === 'scratch')
          setSessionRepo(spawnParentRepo(session))
        }
      })
      .catch(() => {})
  }, [name])

  // Auto-redirect countdown when session not found
  useEffect(() => {
    if (!notFound) return
    if (countdown <= 0) {
      navigate('/')
      return
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000)
    return () => clearTimeout(timer)
  }, [notFound, countdown, navigate])

  // Persist right panel selection
  useEffect(() => {
    localStorage.setItem('lumbergh:rightPanel', rightPanel)
  }, [rightPanel])

  // Compute effective tab visibility (session overrides global)
  const effectiveTabVisibility = useMemo<TabVisibility>(
    () =>
      sessionTabVisibility
        ? { ...globalTabVisibility, ...sessionTabVisibility }
        : globalTabVisibility,
    [globalTabVisibility, sessionTabVisibility]
  )

  const visibleTabs = useMemo(
    () => ALL_TABS.filter((t) => effectiveTabVisibility[t.id] !== false),
    [effectiveTabVisibility]
  )

  const visibleMobileTabs = useMemo(
    () =>
      [{ id: 'terminal' as MobileTab, label: 'Term', Icon: SquareTerminal }].concat(
        ALL_TABS.filter((t) => effectiveTabVisibility[t.id] !== false)
      ),
    [effectiveTabVisibility]
  )

  const isTerminalOnly = visibleTabs.length === 0

  // Quick, non-persisted "get it out of my way" toggle for the right pane
  // group. Deliberately separate from tabVisibility (the gear icon's
  // persisted, global/session setting) -- this is local UI state that resets
  // on reload rather than a saved preference.
  const [rightPaneCollapsed, setRightPaneCollapsed] = useState(false)

  const {
    maximized,
    terminalMaximized,
    terminalVisible,
    collapse: layoutCollapse,
  } = paneLayout(focus, fullPane, isTerminalOnly)
  const collapse = resolveCollapse(layoutCollapse, rightPaneCollapsed)

  const handleTogglePanel = useCallback(() => {
    setFullPane('panel')
    togglePanel()
  }, [togglePanel])

  // Auto-select first visible tab if current is hidden
  useEffect(() => {
    if (visibleTabs.length > 0 && effectiveTabVisibility[rightPanel] === false) {
      setRightPanel(visibleTabs[0].id)
    }
  }, [effectiveTabVisibility, rightPanel, visibleTabs])

  useEffect(() => {
    if (mobileTab !== 'terminal' && effectiveTabVisibility[mobileTab] === false) {
      setMobileTab('terminal')
    }
  }, [effectiveTabVisibility, mobileTab])

  // Close tab settings popover on outside click
  useEffect(() => {
    if (!showTabSettings) return
    const handleClick = (e: MouseEvent) => {
      if (tabSettingsRef.current && !tabSettingsRef.current.contains(e.target as Node)) {
        setShowTabSettings(false)
      }
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [showTabSettings])

  // Save per-session tab visibility
  const saveSessionTabVisibility = useCallback(
    async (tv: TabVisibility) => {
      if (!name) return
      setSessionTabVisibility(tv)
      try {
        await fetch(`${getApiBase()}/sessions/${name}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ tabVisibility: tv }),
        })
      } catch (err) {
        console.error('Failed to save tab visibility:', err)
      }
    },
    [name]
  )

  const saveShowSessionDots = useCallback(async (value: boolean) => {
    setShowSessionDots(value)
    try {
      await fetch(`${getApiBase()}/settings`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ showSessionDots: value }),
      })
    } catch (err) {
      console.error('Failed to save session dots setting:', err)
    }
  }, [])

  const handleFocusReady = useCallback((fn: () => void) => {
    focusFnRef.current = fn
  }, [])

  // Every "send this to the terminal" path funnels through here. While a panel
  // fills the view the terminal is display:none, so focusing it alone would look
  // like the send did nothing -- surface the terminal first so the user sees what
  // they just sent to. Full screen stays full screen: it switches to the terminal
  // tab rather than dropping back to the split.
  const handleFocusTerminal = useCallback(() => {
    if (maximized) setFullPane('terminal')
    else if (focus === 'panel') setFocus('none')
    focusFnRef.current?.()
  }, [focus, maximized, setFocus])

  const handleSwitchToTerminal = useCallback(() => {
    setMobileTab('terminal')
    handleFocusTerminal()
  }, [handleFocusTerminal])

  const handleJumpToTodos = useCallback(() => {
    if (effectiveTabVisibility['todos'] === false) return
    setRightPanel('todos')
    setMobileTab('todos')
  }, [effectiveTabVisibility])

  const handleTodoSent = useCallback(
    async (text: string) => {
      if (!name) return
      try {
        await fetch(`${getApiBase()}/sessions/${name}/status-summary`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        })
      } catch (err) {
        console.error('Failed to update status summary:', err)
      }
    },
    [name]
  )

  const handleCycleSession = useCallback(
    async (direction: 'next' | 'prev') => {
      try {
        const res = await fetch(`${getApiBase()}/sessions`)
        if (!res.ok) return
        const data = await res.json()
        const active = (data.sessions || [])
          .filter((s: { alive: boolean; paused?: boolean }) => s.alive && !s.paused)
          .sort((a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name))
        if (active.length <= 1) return
        const currentIdx = active.findIndex((s: { name: string }) => s.name === name)

        // On forward cycle, check starred sessions first — visit the first idle one
        if (direction === 'next') {
          const starredIdle = active.filter(
            (s: { name: string; theOne?: boolean; idleState?: string }) =>
              s.theOne && s.name !== name && s.idleState === 'idle'
          )
          if (starredIdle.length > 0) {
            navigate(`/session/${starredIdle[0].name}`)
            return
          }
        }

        const step = direction === 'next' ? 1 : active.length - 1
        const nextIdx = (currentIdx + step) % active.length
        navigate(`/session/${active[nextIdx].name}`)
      } catch {
        // Ignore errors
      }
    },
    [name, navigate]
  )

  // Ctrl+[ / Ctrl+] to cycle sessions
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.ctrlKey && (e.key === '[' || e.key === ']')) {
        e.preventDefault()
        handleCycleSession(e.key === ']' ? 'next' : 'prev')
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [handleCycleSession])

  const handleBack = useCallback(() => {
    navigate('/')
  }, [navigate])

  const handleReset = useCallback(async () => {
    if (!name) return
    try {
      const res = await fetch(`${getApiBase()}/sessions/${name}/reset`, {
        method: 'POST',
      })
      if (!res.ok) {
        const data = await res.json()
        throw new Error(data.detail || 'Failed to reset session')
      }
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to reset session')
    }
  }, [name])

  /** A worktree off this repo with the agent already running — no dialog, because
   * the point is to start a second thread of work without breaking this one. */
  const handleQuickWorktree = useCallback(async () => {
    if (!sessionRepo || spawningQuick) return
    setSpawningQuick(true)
    try {
      const res = await fetch(`${getApiBase()}/sessions/quick-worktree`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parent_repo: sessionRepo }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.detail || 'Failed to create worktree')
      navigate(`/session/${data.name}`)
    } catch (err) {
      alert(err instanceof Error ? err.message : 'Failed to create worktree')
    } finally {
      setSpawningQuick(false)
    }
  }, [sessionRepo, spawningQuick, navigate])

  const diffEtagRef = useRef<string>('')

  const fetchDiffData = useCallback(
    async ({ force = false }: { force?: boolean } = {}) => {
      if (!name) return
      try {
        const headers: Record<string, string> = {}
        if (!force && diffEtagRef.current) headers['If-None-Match'] = diffEtagRef.current
        if (force) {
          // Invalidate backend cache so we get a fresh computation
          await fetch(`${getApiBase()}/sessions/${name}/git/invalidate`, { method: 'POST' }).catch(
            () => {}
          )
        }
        const res = await fetch(`${getApiBase()}/sessions/${name}/git/diff`, { headers })
        if (res.status === 304) return
        // A failed call answers with an error body, not a diff. Storing that is
        // how a reaped worktree used to take the whole page down — and reporting
        // "no changes" for a directory we cannot read would be a lie.
        setDiffError(res.ok ? null : await errorDetail(res))
        const data = res.ok ? parseDiffPayload(await res.json()) : null
        diffEtagRef.current = res.headers.get('etag') || ''
        // Only update state if data actually changed to prevent scroll resets
        setDiffData((prev) => (diffDataEquals(prev, data) ? prev : data))
      } catch (err) {
        console.error('Failed to fetch diff data:', err)
      }
    },
    [name]
  )

  // Lightweight stats for tab badges (polled always)
  const [diffStats, setDiffStats] = useState<{
    files: number
    additions: number
    deletions: number
  } | null>(null)

  // Is the git tab currently visible? (need to poll full diff data when visible)
  const isDiffVisible = isDesktop ? rightPanel === 'git' && !terminalMaximized : mobileTab === 'git'

  // Poll lightweight diff-stats every 10s (for badge counts)
  const statsEtagRef = useRef<string>('')
  useEffect(() => {
    if (!name) return
    const fetchStats = async () => {
      try {
        const headers: Record<string, string> = {}
        if (statsEtagRef.current) headers['If-None-Match'] = statsEtagRef.current
        const res = await fetch(`${getApiBase()}/sessions/${name}/git/diff-stats`, {
          headers,
        })
        if (res.status === 304) return
        statsEtagRef.current = res.headers.get('etag') || ''
        const data = await res.json()
        setDiffStats((prev) => {
          if (
            prev &&
            prev.files === data.files &&
            prev.additions === data.additions &&
            prev.deletions === data.deletions
          ) {
            return prev
          }
          return data
        })
      } catch {
        // ignore
      }
    }
    fetchStats()
    const interval = setInterval(fetchStats, 10000)
    return () => clearInterval(interval)
  }, [name])

  // Full diff: fetch when diff tab becomes visible + poll while visible
  useEffect(() => {
    if (!isDiffVisible) return
    fetchDiffData()
    const interval = setInterval(fetchDiffData, 5000)
    return () => clearInterval(interval)
  }, [isDiffVisible, fetchDiffData])

  // Global paste handler for image uploads
  useEffect(() => {
    const handlePaste = async (e: ClipboardEvent) => {
      const items = e.clipboardData?.items
      if (!items) return

      for (const item of items) {
        if (item.type.startsWith('image/')) {
          e.preventDefault()
          const file = item.getAsFile()
          if (!file) continue

          const formData = new FormData()
          formData.append('file', file)

          try {
            const res = await fetch(`${getApiBase()}/shared/upload`, {
              method: 'POST',
              body: formData,
            })
            if (res.ok) {
              // Trigger refresh and switch to shared tab
              setSharedRefreshTrigger((n) => n + 1)
              setRightPanel('shared')
              setMobileTab('shared')
            }
          } catch (err) {
            console.error('Failed to upload image:', err)
          }
          break
        }
      }
    }

    document.addEventListener('paste', handlePaste)
    return () => document.removeEventListener('paste', handlePaste)
  }, [])

  // mobileTabs is now computed as visibleMobileTabs above

  const renderTerminal = () => (
    <div className="h-full relative">
      {name ? (
        <Terminal
          sessionName={name}
          onFocusReady={handleFocusReady}
          onBack={isDesktop ? handleBack : undefined}
          onSpawnSession={sessionRepo ? () => setSpawnFromRepo(sessionRepo) : undefined}
          onQuickWorktree={sessionRepo ? handleQuickWorktree : undefined}
          onForkSession={name ? () => setForkFrom(name) : undefined}
          onReset={handleReset}
          onCycleSession={handleCycleSession}
          // The mobile layout already carries a compact dot strip in its tab
          // bar; a second row of the same dots is the busiest thing on a phone.
          showSessionDots={showSessionDots && isDesktop}
          isVisible={view === 'term' && (isDesktop || mobileTab === 'terminal') && terminalVisible}
          collapseHeader={focus === 'main'}
          view={view}
          onToggleView={toggleView}
          scale={scale}
          onScaleChange={setScale}
        />
      ) : (
        <div className="flex items-center justify-center h-full text-text-muted">
          No session selected
        </div>
      )}
      {spawnFromRepo && (
        <CreateSessionModal
          initialMode="worktree"
          initialParentRepo={spawnFromRepo}
          onClose={() => setSpawnFromRepo(null)}
          onCreated={() => setSpawnFromRepo(null)}
        />
      )}
      {forkFrom && (
        <CreateSessionModal
          forkFrom={forkFrom}
          initialMode="worktree"
          initialParentRepo={sessionRepo}
          onClose={() => setForkFrom(null)}
          onCreated={() => setForkFrom(null)}
        />
      )}
    </div>
  )

  const renderMobileTabContent = () => (
    <ErrorBoundary key={`${name}:${mobileTab}`} label={panelLabel(mobileTab)}>
      {mobileTab === 'git' && (
        <GitTab
          sessionName={name}
          diffData={diffData}
          diffError={diffError}
          onRefreshDiff={() => fetchDiffData({ force: true })}
          onJumpToTodos={handleJumpToTodos}
          onFocusTerminal={handleFocusTerminal}
          resetTrigger={gitTabResetTrigger}
        />
      )}
      {mobileTab === 'files' && (
        <FileBrowser sessionName={name} onFocusTerminal={handleFocusTerminal} />
      )}
      {mobileTab === 'todos' && name && (
        <VerticalResizablePanes
          top={
            <TodoList
              sessionName={name}
              onFocusTerminal={handleFocusTerminal}
              onTodoSent={handleTodoSent}
              onSwitchToTerminal={handleSwitchToTerminal}
            />
          }
          bottom={<Scratchpad sessionName={name} onFocusTerminal={handleFocusTerminal} />}
          defaultTopHeight={50}
          minTopHeight={20}
          maxTopHeight={80}
          storageKey="lumbergh:todoSplitHeight"
        />
      )}
      {mobileTab === 'prompts' && (
        <PromptTemplates sessionName={name} onFocusTerminal={handleFocusTerminal} />
      )}
      {mobileTab === 'shared' && (
        <SharedFiles
          sessionName={name}
          onFocusTerminal={handleFocusTerminal}
          refreshTrigger={sharedRefreshTrigger}
        />
      )}
    </ErrorBoundary>
  )

  // The switcher lives inside the panel while the view is split, and above both
  // panes while one of them is maximized. Maximized shows a single pane, so the
  // strip has to offer the terminal as a tab of its own -- mobile already works
  // this way, and without it full screen is a room with no door back to the
  // terminal.
  const renderPanelTabs = () => (
    <div className="flex gap-1 p-2 bg-bg-surface border-b border-border-default">
      {canQuickCollapse(maximized, isTerminalOnly) && (
        <>
          <button
            onClick={() => setRightPaneCollapsed(true)}
            data-testid="panel-quick-collapse"
            className="px-2 py-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-control-bg-hover transition-colors"
            title="Hide side panels"
          >
            <ChevronsRight size={14} />
          </button>
          <div className="w-px bg-border-default my-1" />
        </>
      )}
      {maximized && (
        <button
          data-testid="tab-terminal"
          onClick={() => setFullPane('terminal')}
          onDoubleClick={handleTogglePanel}
          className={`select-none flex items-center gap-1.5 px-3 py-1 rounded text-sm font-medium transition-colors ${
            fullPane === 'terminal'
              ? 'bg-control-bg-hover text-text-primary'
              : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
          }`}
        >
          <SquareTerminal size={14} />
          Term
        </button>
      )}
      {visibleTabs.map((tab) => (
        <button
          key={tab.id}
          data-testid={`tab-${tab.id === 'todos' ? 'todo' : tab.id}`}
          onClick={() => {
            setRightPanel(tab.id)
            setFullPane('panel')
            if (tab.id === 'git') setGitTabResetTrigger((n) => n + 1)
          }}
          // Double-click is the same toggle as the maximize button: the two
          // onClicks it also fires just select the tab first, so double-clicking
          // an inactive tab lands you in it, full screen.
          onDoubleClick={handleTogglePanel}
          className={`select-none px-3 py-1 rounded text-sm font-medium transition-colors ${
            rightPanel === tab.id && !terminalMaximized
              ? 'bg-control-bg-hover text-text-primary'
              : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
          }`}
        >
          {tab.label}
          {tab.id === 'git' && diffStats && diffStats.files > 0 && (
            <span className="ml-2 text-xs">
              ({diffStats.files})<span className="text-success ml-1">+{diffStats.additions}</span>
              <span className="text-danger ml-1">-{diffStats.deletions}</span>
            </span>
          )}
        </button>
      ))}
      <button
        onClick={handleTogglePanel}
        data-testid="panel-maximize"
        className="ml-auto px-2 py-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-control-bg-hover transition-colors"
        title={focus === 'panel' ? 'Restore split view' : 'Maximize panel'}
      >
        {focus === 'panel' ? <Minimize2 size={14} /> : <Maximize2 size={14} />}
      </button>
      {/* Gear icon for tab visibility settings */}
      <div className="relative" ref={tabSettingsRef}>
        <button
          onClick={() => setShowTabSettings((v) => !v)}
          className="px-2 py-1 rounded text-text-tertiary hover:text-text-secondary hover:bg-control-bg-hover transition-colors"
          title="Configure visible tabs"
        >
          <Settings size={14} />
        </button>
        {showTabSettings && (
          <div className="absolute right-0 top-full mt-1 bg-bg-surface border border-border-default rounded-[var(--radius-xl)] shadow-lg p-3 z-50 min-w-[160px]">
            <p className="text-xs text-text-tertiary mb-2 font-medium">Visible Tabs</p>
            <label className="flex items-center gap-2 py-1 text-sm border-b border-border-default mb-1 pb-2">
              <input
                type="checkbox"
                checked={isTerminalOnly}
                onChange={() => {
                  const currentVis = sessionTabVisibility || globalTabVisibility
                  if (isTerminalOnly) {
                    // Restore: use global defaults
                    saveSessionTabVisibility({ ...globalTabVisibility })
                  } else {
                    // Set all to false
                    const allOff = Object.fromEntries(
                      Object.keys(currentVis).map((k) => [k, false])
                    )
                    saveSessionTabVisibility(allOff)
                  }
                }}
                className="rounded border-input-border bg-input-bg"
              />
              <span className="text-text-secondary font-medium">Terminal Only</span>
            </label>
            {ALL_TABS.map((tab) => {
              const currentVis = sessionTabVisibility || globalTabVisibility
              const isEnabled = currentVis[tab.id] !== false
              return (
                <label key={tab.id} className="flex items-center gap-2 py-1 text-sm">
                  <input
                    type="checkbox"
                    checked={isEnabled}
                    onChange={() => {
                      const updated = { ...currentVis, [tab.id]: !isEnabled }
                      saveSessionTabVisibility(updated)
                    }}
                    className="rounded border-input-border bg-input-bg"
                  />
                  <span className="text-text-secondary">{tab.label}</span>
                </label>
              )
            })}
            <label className="flex items-center gap-2 py-1 text-sm border-t border-border-default mt-1 pt-2">
              <input
                type="checkbox"
                checked={showSessionDots}
                onChange={() => saveShowSessionDots(!showSessionDots)}
                className="rounded border-input-border bg-input-bg"
              />
              <span className="text-text-secondary">Session Dots</span>
            </label>
          </div>
        )}
      </div>
    </div>
  )

  const renderRightPanel = () => (
    <div className="h-full flex flex-col">
      {!maximized && renderPanelTabs()}
      {/* Panel content — boundaried so a panel that throws does not take the
          terminal (and the rest of the app) down with it. */}
      <div className="flex-1 min-h-0 overflow-hidden">
        <ErrorBoundary key={`${name}:${rightPanel}`} label={panelLabel(rightPanel)}>
          {rightPanel === 'git' && (
            <GitTab
              key={name}
              sessionName={name}
              diffData={diffData}
              diffError={diffError}
              onRefreshDiff={() => fetchDiffData({ force: true })}
              onJumpToTodos={handleJumpToTodos}
              onFocusTerminal={handleFocusTerminal}
              resetTrigger={gitTabResetTrigger}
              maximized={maximized}
            />
          )}
          {rightPanel === 'files' && (
            <FileBrowser sessionName={name} onFocusTerminal={handleFocusTerminal} />
          )}
          {rightPanel === 'todos' && name && (
            <VerticalResizablePanes
              top={
                <TodoList
                  sessionName={name}
                  onFocusTerminal={handleFocusTerminal}
                  onTodoSent={handleTodoSent}
                  onSwitchToTerminal={handleSwitchToTerminal}
                />
              }
              bottom={<Scratchpad sessionName={name} onFocusTerminal={handleFocusTerminal} />}
              defaultTopHeight={50}
              minTopHeight={20}
              maxTopHeight={80}
              storageKey="lumbergh:todoSplitHeight"
            />
          )}
          {rightPanel === 'prompts' && (
            <PromptTemplates sessionName={name} onFocusTerminal={handleFocusTerminal} />
          )}
          {rightPanel === 'shared' && (
            <SharedFiles
              sessionName={name}
              onFocusTerminal={handleFocusTerminal}
              refreshTrigger={sharedRefreshTrigger}
            />
          )}
        </ErrorBoundary>
      </div>
    </div>
  )

  if (notFound) {
    return (
      <div className="h-full flex flex-col items-center justify-center bg-bg-sunken text-text-primary gap-4">
        <div className="text-danger text-xl font-semibold">Session Not Found</div>
        <p className="text-text-tertiary text-sm text-center px-4">
          The session <span className="text-text-secondary font-mono">"{name}"</span> does not exist
          or has been deleted.
        </p>
        <button
          onClick={() => navigate('/')}
          className="px-4 py-2 bg-action hover:brightness-110 text-white rounded text-sm transition-colors"
        >
          Go to Dashboard
        </button>
        <p className="text-text-tertiary text-xs">Redirecting in {countdown}s...</p>
      </div>
    )
  }

  return (
    <div className="h-full flex flex-col bg-bg-sunken text-text-primary">
      {focus === 'none' && (
        <ScratchPromoteBanner
          sessionName={name!}
          isScratch={isScratch}
          onPromoted={() => setIsScratch(false)}
        />
      )}
      {showTelemetryOptIn && <TelemetryOptIn onClose={() => setShowTelemetryOptIn(false)} />}

      {/* Conditionally render only desktop OR mobile layout (not both) */}
      {isDesktop ? (
        <main className="flex-1 min-h-0 flex flex-col">
          {maximized && renderPanelTabs()}
          <div className="flex-1 min-h-0">
            <ResizablePanes
              collapse={collapse}
              left={
                <div className="h-full relative">
                  <ZenTerminal active={focus === 'main'} onExit={() => setFocus('none')}>
                    {renderTerminal()}
                  </ZenTerminal>
                  {isTerminalOnly && focus !== 'main' && (
                    <button
                      onClick={() => saveSessionTabVisibility({ ...globalTabVisibility })}
                      className="absolute top-14 right-2 px-2 py-1 rounded bg-bg-surface/80 border border-border-default text-text-tertiary hover:text-text-primary text-xs transition-colors backdrop-blur-sm flex items-center gap-1"
                      title="Show side panels"
                    >
                      <ChevronsLeft size={14} />
                      Tabs
                    </button>
                  )}
                  {canQuickRestore(isTerminalOnly, rightPaneCollapsed, focus, maximized) && (
                    <button
                      onClick={() => setRightPaneCollapsed(false)}
                      className="absolute top-14 right-2 px-2 py-1 rounded bg-bg-surface/80 border border-border-default text-text-tertiary hover:text-text-primary text-xs transition-colors backdrop-blur-sm flex items-center gap-1"
                      title="Show side panels"
                    >
                      <ChevronsLeft size={14} />
                      Panels
                    </button>
                  )}
                </div>
              }
              right={renderRightPanel()}
              defaultLeftWidth={50}
              minLeftWidth={25}
              maxLeftWidth={75}
              storageKey="lumbergh:mainSplitWidth"
            />
          </div>
        </main>
      ) : (
        <div className="flex-1 min-h-0 flex flex-col">
          {/* Tab navigation with back button */}
          <div className="flex gap-1 px-2 py-1 bg-bg-surface border-b border-border-default overflow-hidden">
            {/* Back button */}
            <button
              onClick={() => navigate('/')}
              className="shrink-0 px-2 py-1.5 text-text-tertiary hover:text-text-primary transition-colors"
              title="Back to Dashboard"
            >
              <ArrowLeft size={16} />
            </button>
            {/* Separator */}
            <div className="w-px shrink-0 bg-border-default my-1" />
            {showSessionDots && name && (
              <>
                <div className="flex-1 min-w-0 overflow-x-auto scrollbar-hide">
                  <SessionNavigatorDots compact currentSessionName={name} />
                </div>
                <div className="w-px shrink-0 bg-border-default my-1" />
              </>
            )}
            {visibleMobileTabs.map((tab) => (
              <button
                key={tab.id}
                data-testid={`tab-${tab.id === 'todos' ? 'todo' : tab.id}`}
                onClick={() => {
                  setMobileTab(tab.id)
                  if (tab.id === 'git') setGitTabResetTrigger((n) => n + 1)
                }}
                title={tab.label}
                aria-label={tab.label}
                className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded text-sm font-medium transition-colors ${
                  mobileTab === tab.id
                    ? 'bg-control-bg-hover text-text-primary'
                    : 'bg-control-bg text-text-tertiary hover:bg-control-bg-hover hover:text-text-secondary'
                }`}
              >
                <tab.Icon size={16} />
                {tab.id === 'git' && diffStats && diffStats.files > 0 && (
                  <span className="text-xs tabular-nums">{diffStats.files}</span>
                )}
              </button>
            ))}
          </div>
          {/* Tab content */}
          <div className="flex-1 min-h-0 overflow-hidden">
            {/* Terminal stays mounted to preserve WebSocket connection and buffer */}
            <div className={`h-full ${mobileTab === 'terminal' ? '' : 'hidden'}`}>
              {renderTerminal()}
            </div>
            {renderMobileTabContent()}
          </div>
        </div>
      )}
    </div>
  )
}
