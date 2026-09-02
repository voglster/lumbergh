/** Chords that drive the app rather than reaching the shell: Ctrl+[ / Ctrl+],
 * Alt+Left / Alt+Right, Alt+Z, and Alt+V. xterm must decline them so they bubble to
 * the window listeners in SessionDetail, useSessionSwitchKeys, useFocusMode and
 * useSessionView — and so they never reach tmux as escape sequences. */
export function isSessionCycleChord(event: KeyboardEvent): boolean {
  if (event.ctrlKey && (event.key === '[' || event.key === ']')) return true
  if (event.altKey && (event.key === 'ArrowLeft' || event.key === 'ArrowRight')) return true
  // Physical key position, not event.key: on macOS Option+Z/V reports event.key as
  // 'Ω'/'√', which would make these chords dead. Trade-off: on Dvorak/AZERTY the
  // key labelled Z or V isn't the one that toggles.
  const altOnly = event.altKey && !event.ctrlKey && !event.metaKey
  return altOnly && (event.code === 'KeyZ' || event.code === 'KeyV')
}

/** Keys that should first take the pane out of tmux copy-mode, because copy-mode
 * would otherwise spend them on itself instead of passing them to the agent.
 *
 * Escape is the one that matters: with `mode-keys vi` tmux binds it to
 * clear-selection, so pressing it to stop a runaway agent only drops the
 * copy-mode selection and stays in the mode — the agent never sees it. */
export function exitsScrollMode(event: KeyboardEvent): boolean {
  if (event.type !== 'keydown') return false
  if (event.ctrlKey || event.metaKey || event.altKey) return false
  return event.key.length === 1 || event.key === 'Escape'
}

/** Ctrl+V (Cmd+V on macOS) as a paste rather than a literal `^V` byte.
 *
 * xterm.js sends `^V` by default and reserves paste for Ctrl+Shift+V, which keeps
 * vim's visual-block binding intact. That default also breaks every dictation and
 * clipboard-injection tool (Wispr Flow and friends): they paste by writing the OS
 * clipboard and simulating Ctrl+V, so the text silently never arrives.
 *
 * Declining the key here is what makes it work. A custom key handler that returns
 * false leaves `preventDefault()` uncalled, so the browser's own paste proceeds and
 * xterm's native `paste` listener inserts the text — with bracketed paste handled
 * for us, no clipboard-read permission, and no secure context needed (Lumbergh is
 * routinely served over plain http on a LAN).
 *
 * Alt is excluded so Ctrl+Alt+V still sends a literal `^V`, and Shift is excluded
 * because Ctrl+Shift+V is already xterm's own paste. */
export function isPasteChord(event: KeyboardEvent): boolean {
  if (event.type !== 'keydown') return false
  if (event.shiftKey || event.altKey) return false
  // Physical key position, preferred: on a non-QWERTY layout the key labelled V
  // is not the one the OS paste shortcut uses, and the OS shortcut is what we
  // are matching. But dictation/injection tools (Wispr Flow and friends) send a
  // trusted, OS-level Ctrl+V whose `code` is sometimes empty - there's no
  // physical key behind it, so there's nothing to report. Fall back to the
  // produced character in that case rather than dropping the paste.
  const matchesV = event.code ? event.code === 'KeyV' : event.key.toLowerCase() === 'v'
  if (!matchesV) return false
  return event.ctrlKey !== event.metaKey
}
