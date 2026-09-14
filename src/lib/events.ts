/**
 * The Rust→React event channel — typed subscriptions over the generated
 * `events` object (tauri-specta). Event names AND payload types come from
 * the same generated definition the Rust side emits through, so neither
 * side can drift; this layer only adds the lifecycle convention:
 * `onX(cb)` returns a synchronous unsubscribe, so effect cleanups and
 * try/finally blocks never juggle unlisten promises.
 *
 * The help- and projection-window protocols have no generated form —
 * `emitTo` (main window → the secondary webviews) is not part of
 * tauri-specta's generated surface — so their names and payloads live
 * here too: this is the single module that knows them.
 * `HELP_WINDOW_LABEL`/`HelpTarget` are defined here and re-exported from
 * help-window.ts for existing importers.
 */
import { emitTo, listen } from '@tauri-apps/api/event'
import { events } from '@/lib/tauri-bindings'
import type {
  SessionSnapshot,
  SetlistExportProgressEvent,
  WindowStateSnapshot,
} from '@/lib/tauri-bindings'
import type { ColorTheme } from '@/lib/color-theme'

/** The help webview's Tauri window label. */
export const HELP_WINDOW_LABEL = 'help'

/** v1.5.0 (#129): the projection window's stable label. */
export const PROJECTION_WINDOW_LABEL = 'projection'

/** Where the help window should navigate: the search box or one document. */
export type HelpTarget = { kind: 'search' } | { kind: 'doc'; docId: string }

/** Synchronous unsubscribe — the unlisten promise resolves internally. */
export type Unsubscribe = () => void

function toUnsubscribe(pending: Promise<() => void>): Unsubscribe {
  return () => {
    void pending.then(off => off())
  }
}

/** Every session snapshot publication (the state machine's funnel). */
export function onSessionSnapshot(
  cb: (snapshot: SessionSnapshot) => void
): Unsubscribe {
  return toUnsubscribe(
    events.sessionSnapshotEvent.listen(e => cb(e.payload.snapshot))
  )
}

/** Window chrome state (fullscreen, traffic lights, fade generation). */
export function onWindowState(
  cb: (snapshot: WindowStateSnapshot) => void
): Unsubscribe {
  return toUnsubscribe(
    events.windowStateEvent.listen(e => cb(e.payload.snapshot))
  )
}

/**
 * v1.5.0 (#130): the projection window's existence. Destruction is
 * observed by Rust (every close path); creation is announced by the
 * opener on the webview's own `tauri://created` (Tauri 2 has no
 * run-level window-created event) — both through this one generated
 * event, so the main window's ▶ gate button follows the truth, not a
 * frontend guess.
 */
export function onProjectionWindow(cb: (exists: boolean) => void): Unsubscribe {
  return toUnsubscribe(
    events.projectionWindowEvent.listen(e => cb(e.payload.exists))
  )
}

/** Opener side: announce the projection window just came alive. */
export function emitProjectionWindowExists(exists: boolean): Promise<void> {
  return events.projectionWindowEvent.emit({ exists })
}

/**
 * The window regained macOS focus (emitted payload-less; consumers
 * re-derive from stores — AppShell restores the session snapshot,
 * MonitorView reclaims the keyboard focus).
 */
export function onWindowFocus(cb: () => void): Unsubscribe {
  return toUnsubscribe(events.windowFocusEvent.listen(() => cb()))
}

/** A queued `.pnds` bundle finished installing — open it. */
export function onOpenBundle(cb: () => void): Unsubscribe {
  return toUnsubscribe(events.openBundleEvent.listen(() => cb()))
}

/** Setlist folder export progress, once per packed project. */
export function onSetlistExportProgress(
  cb: (progress: SetlistExportProgressEvent) => void
): Unsubscribe {
  return toUnsubscribe(
    events.setlistExportProgressEvent.listen(e => cb(e.payload))
  )
}

// ---------------------------------------------------------------------------
// Help window protocol (emitTo-targeted; names held only here)
// ---------------------------------------------------------------------------

/** The help webview finished booting and is listening for navigation. */
export function onHelpReady(cb: () => void): Unsubscribe {
  return toUnsubscribe(events.helpReadyEvent.listen(() => cb()))
}

/** HelpCenter side of the ready handshake. */
export function emitHelpReady(): Promise<void> {
  return events.helpReadyEvent.emit({})
}

const HELP_NAVIGATE = 'pnds:help-navigate'
const HELP_LOCALE = 'pnds:help-locale'
const HELP_THEME = 'pnds:help-theme'

/** HelpCenter side: receive navigation pushed from the main window. */
export function onHelpNavigate(cb: (target: HelpTarget) => void): Unsubscribe {
  return toUnsubscribe(listen<HelpTarget>(HELP_NAVIGATE, e => cb(e.payload)))
}

/** Main-window side: navigate the (booted) help window. */
export function emitHelpNavigate(target: HelpTarget): Promise<void> {
  return emitTo(HELP_WINDOW_LABEL, HELP_NAVIGATE, target)
}

/** HelpCenter side: follow the main window's UI language. */
export function onHelpLocale(cb: (locale: string) => void): Unsubscribe {
  return toUnsubscribe(
    listen<{ locale: string }>(HELP_LOCALE, e => cb(e.payload.locale))
  )
}

/** Main-window side: push a UI-language change to the help window. */
export function emitHelpLocale(locale: string): Promise<void> {
  return emitTo(HELP_WINDOW_LABEL, HELP_LOCALE, { locale })
}

/** HelpCenter side: follow the main window's color theme. */
export function onHelpTheme(cb: (theme: ColorTheme) => void): Unsubscribe {
  return toUnsubscribe(
    listen<{ colorTheme: ColorTheme }>(HELP_THEME, e =>
      cb(e.payload.colorTheme)
    )
  )
}

/** Main-window side: push a color-theme change to the help window. */
export function emitHelpTheme(theme: ColorTheme): Promise<void> {
  return emitTo(HELP_WINDOW_LABEL, HELP_THEME, { colorTheme: theme })
}

// ---------------------------------------------------------------------------
// Projection window protocol (emitTo-targeted; names held only here) —
// v1.5.0 (#129). Thinner than the help protocol on purpose: the session
// content arrives through the broadcast SessionSnapshotEvent (plus the
// getSessionState restore), so only the live-follow bridges — theme and
// language — need a main-window push. There is no navigation target and
// no ready handshake to replay.
// ---------------------------------------------------------------------------

const PROJECTION_LOCALE = 'pnds:projection-locale'
const PROJECTION_THEME = 'pnds:projection-theme'
const PROJECTION_ACTION = 'pnds:projection-action'

/** Projection side: follow the main window's UI language. */
export function onProjectionLocale(cb: (locale: string) => void): Unsubscribe {
  return toUnsubscribe(
    listen<{ locale: string }>(PROJECTION_LOCALE, e => cb(e.payload.locale))
  )
}

/** Main-window side: push a UI-language change to the projection window. */
export function emitProjectionLocale(locale: string): Promise<void> {
  return emitTo(PROJECTION_WINDOW_LABEL, PROJECTION_LOCALE, { locale })
}

/** Projection side: follow the main window's color theme. */
export function onProjectionTheme(
  cb: (theme: ColorTheme) => void
): Unsubscribe {
  return toUnsubscribe(
    listen<{ colorTheme: ColorTheme }>(PROJECTION_THEME, e =>
      cb(e.payload.colorTheme)
    )
  )
}

/** Main-window side: push a color-theme change to the projection window. */
export function emitProjectionTheme(theme: ColorTheme): Promise<void> {
  return emitTo(PROJECTION_WINDOW_LABEL, PROJECTION_THEME, {
    colorTheme: theme,
  })
}

/**
 * v1.5.0 (#131): a keyboard action the main window's menu dispatches TO
 * the projection window (its accelerators are app-wide but their effect
 * is per-window). The zoom lives in the projection page's local state —
 * independent of the main window's, alive with the window, never in
 * preferences — so the action is a verb, never a value.
 */
export type ProjectionAction =
  | { kind: 'zoom-in' }
  | { kind: 'zoom-out' }
  | { kind: 'zoom-reset' }
  | { kind: 'reload-monitor' }

/** Projection side: receive a dispatched keyboard action. */
export function onProjectionAction(
  cb: (action: ProjectionAction) => void
): Unsubscribe {
  return toUnsubscribe(
    listen<ProjectionAction>(PROJECTION_ACTION, e => cb(e.payload))
  )
}

/** Main-window side: dispatch a keyboard action to the projection window. */
export function emitProjectionAction(action: ProjectionAction): Promise<void> {
  return emitTo(PROJECTION_WINDOW_LABEL, PROJECTION_ACTION, action)
}
