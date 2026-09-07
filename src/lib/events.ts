/**
 * The Rust→React event channel — typed subscriptions over the generated
 * `events` object (tauri-specta). Event names AND payload types come from
 * the same generated definition the Rust side emits through, so neither
 * side can drift; this layer only adds the lifecycle convention:
 * `onX(cb)` returns a synchronous unsubscribe, so effect cleanups and
 * try/finally blocks never juggle unlisten promises.
 *
 * The help-window protocol has no generated form — `emitTo` (main window
 * → help webview) is not part of tauri-specta's generated surface — so
 * its names and payloads live here too: this is the single module that
 * knows them. `HELP_WINDOW_LABEL`/`HelpTarget` are defined here and
 * re-exported from help-window.ts for existing importers.
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
