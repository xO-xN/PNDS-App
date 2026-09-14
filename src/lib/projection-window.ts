/**
 * v1.5.0 (#129): the projection window's lifecycle — everything the
 * sidebar button and the ⌘W dispatch need, outside React. The venue
 * screen is a single-instance SECOND webview window of the same app
 * (ADR-0006: same engine as the main window, not a bare browser), built
 * on the help center's window pattern (#56): fixed label, HIDDEN create
 * (the #51 anti-flash pattern — the page reveals itself via fade-in
 * once its theme and first session snapshot have landed), reuse by
 * focus, and a re-reveal for a window stuck hidden.
 *
 * Unlike the help window it is created POSITIONED on the App's current
 * monitor (the operator plugs the venue screen and clicks — the window
 * must not land on an unexpected display), and it is deliberately NOT
 * tracked by the window-state plugin (Rust side denylist): cross-launch
 * position/fullscreen persistence is out of scope (spec #128), and a
 * restored stale geometry would fight the current-monitor placement.
 * Within a run the window is never recreated, so switching projects
 * keeps its position and fullscreen by construction.
 */

import {
  PROJECTION_WINDOW_LABEL,
  emitProjectionLocale,
  emitProjectionTheme,
} from '@/lib/events'

export { PROJECTION_WINDOW_LABEL } from '@/lib/events'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { currentMonitor } from '@tauri-apps/api/window'
import i18n, { currentResolvedLanguage } from '@/i18n/config'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { isSessionRunning, useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { commands } from '@/lib/tauri-bindings'

/** Create-time geometry: a venue-screen-shaped default. */
const PROJECTION_WIDTH = 1280
const PROJECTION_HEIGHT = 800
const PROJECTION_MIN_WIDTH = 960
const PROJECTION_MIN_HEIGHT = 600

/**
 * Where the projection window should be created: centered on the
 * monitor the MAIN window (the caller) currently occupies — the venue
 * screen is where the operator is looking. Physical pixels both sides
 * (monitor geometry and window x/y options), so no DPI math. A failed
 * monitor query falls back to the system-centered create.
 */
async function centeredOnCurrentMonitor(): Promise<{
  x: number
  y: number
}> {
  const monitor = await currentMonitor()
  if (!monitor) throw new Error('no current monitor')
  return {
    x:
      monitor.position.x +
      Math.round((monitor.size.width - PROJECTION_WIDTH) / 2),
    y:
      monitor.position.y +
      Math.round((monitor.size.height - PROJECTION_HEIGHT) / 2),
  }
}

/**
 * The projection window's native title at create time — the running
 * session's project name while one runs, plain otherwise. The page
 * itself keeps the title current (snapshot + language) once booted;
 * this only pins the first frame (the window is hidden then anyway).
 */
function projectionWindowTitle(): string {
  const { sessionStatus, projectName } = useSessionStore.getState()
  return isSessionRunning(sessionStatus) && projectName
    ? i18n.t('projection.windowTitle', { name: projectName })
    : i18n.t('projection.windowTitleIdle')
}

/**
 * Opens (or reuses) the projection window — the sidebar button's
 * action. Already open → focus (single instance: the venue screen must
 * never hold two stacked windows); open but stuck hidden → re-run the
 * reveal (the #56 rule: never focus an invisible window); otherwise
 * create it hidden on the App's current monitor.
 */
export async function openProjectionWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(PROJECTION_WINDOW_LABEL)
  if (existing) {
    try {
      if (!(await existing.isVisible())) {
        await commands.fadeInWindow(PROJECTION_WINDOW_LABEL)
      } else {
        await existing.setFocus()
      }
    } catch (error) {
      logger.warn('Failed to focus the projection window', { error })
    }
    return
  }

  // The current-monitor placement is best-effort: a failed query must
  // not eat the open — fall back to the system-centered create.
  let position: { x: number; y: number } | null = null
  try {
    position = await centeredOnCurrentMonitor()
  } catch (error) {
    logger.warn('Failed to place the projection window; centering instead', {
      error,
    })
  }

  const projectionWindow = new WebviewWindow(PROJECTION_WINDOW_LABEL, {
    url: 'projection.html',
    title: projectionWindowTitle(),
    width: PROJECTION_WIDTH,
    height: PROJECTION_HEIGHT,
    minWidth: PROJECTION_MIN_WIDTH,
    minHeight: PROJECTION_MIN_HEIGHT,
    ...(position ?? { center: true }),
    resizable: true,
    // #51 hidden-create: the page calls the reveal itself once ready.
    visible: false,
  })
  projectionWindow.once('tauri://error', error => {
    logger.error('Failed to create the projection window', { error })
    notifications.error(i18n.t('toast.error.generic'))
  })
}

/**
 * Closes the projection window (the ⌘W dispatch when it is the focused
 * window — the running session and the main window are untouched). No-op
 * when none exists.
 */
export async function closeProjectionWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(PROJECTION_WINDOW_LABEL)
  if (!existing) return
  try {
    await existing.close()
  } catch (error) {
    logger.warn('Failed to close the projection window', { error })
  }
}

/**
 * v1.5.0 (#129): the main-window side of the projection bridge — an
 * OPEN projection window live-follows the app's language and Appearance
 * theme (same best-effort pushes as the help center; no window, no
 * delivery, never a throw).
 *
 * Returns an unsubscribe for the caller's cleanup.
 */
export function setupProjectionWindowBridge(): () => void {
  const onLanguage = () => {
    void emitProjectionLocale(currentResolvedLanguage()).catch(() => {
      // No live window to receive it — nothing to do.
    })
  }
  i18n.on('languageChanged', onLanguage)

  let previousTheme = useSettingsStore.getState().colorThemeSetting
  const unsubTheme = useSettingsStore.subscribe(state => {
    if (state.colorThemeSetting === previousTheme) return
    previousTheme = state.colorThemeSetting
    void emitProjectionTheme(previousTheme).catch(() => {
      // No live window to receive it — nothing to do.
    })
  })

  return () => {
    i18n.off('languageChanged', onLanguage)
    unsubTheme()
  }
}
