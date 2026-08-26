/**
 * v1.3.0 (#56): the help center's window lifecycle — everything the Help
 * menu and the ⌘W dispatch need, outside React. Opening either creates
 * the window HIDDEN (the #51 anti-flash pattern: the help page reveals
 * itself via fade-in once its theme and content have landed, so dark
 * users never see a light first frame) with the target encoded in the
 * URL, or reuses the live window by focusing it and sending the target
 * over an event. A window stuck hidden (an early page error) is
 * re-revealed rather than focused into invisibility.
 */

import { emitTo, listen } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import i18n, { currentResolvedLanguage } from '@/i18n/config'
import type { ColorTheme } from '@/lib/color-theme'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { useSettingsStore } from '@/store/settings-store'
import { commands } from '@/lib/tauri-bindings'

/** The help center's stable window label (capabilities, events, ⌘W). */
export const HELP_WINDOW_LABEL = 'help'

/**
 * The last target handed to the window — replayed when the page
 * announces readiness (see setupHelpWindowBridge), so a navigate event
 * sent while the page was still booting is never silently lost.
 */
let lastTarget: HelpTarget | null = null

/** What the help center should land on when it opens or is reused. */
export type HelpTarget = { kind: 'search' } | { kind: 'doc'; docId: string }

function helpUrl(target: HelpTarget): string {
  return target.kind === 'doc'
    ? `help.html?doc=${encodeURIComponent(target.docId)}`
    : 'help.html?search=1'
}

/** Opens (or reuses) the help center window on the given target. */
export async function openHelpWindow(target: HelpTarget): Promise<void> {
  // Remembered for the boot handshake — see setupHelpWindowBridge.
  lastTarget = target
  const existing = await WebviewWindow.getByLabel(HELP_WINDOW_LABEL)
  if (existing) {
    try {
      if (!(await existing.isVisible())) {
        // Stuck hidden (an early page error ate the reveal): re-run the
        // reveal instead of focusing an invisible window.
        await commands.fadeInWindow(HELP_WINDOW_LABEL)
      } else {
        await existing.setFocus()
      }
      await emitTo(HELP_WINDOW_LABEL, 'pnds:help-navigate', target)
    } catch (error) {
      logger.warn('Failed to navigate the open help window', { error })
    }
    return
  }

  const helpWindow = new WebviewWindow(HELP_WINDOW_LABEL, {
    url: helpUrl(target),
    title: i18n.t('help.windowTitle'),
    width: 980,
    height: 720,
    minWidth: 680,
    minHeight: 480,
    center: true,
    resizable: true,
    // #51 hidden-create: the page calls the reveal itself once ready.
    visible: false,
  })
  helpWindow.once('tauri://error', error => {
    logger.error('Failed to create the help window', { error })
    notifications.error(i18n.t('toast.error.generic'))
  })
}

/**
 * Closes the help window (the ⌘W dispatch when it is the focused
 * window). No-op when none exists.
 */
export async function closeHelpWindow(): Promise<void> {
  const existing = await WebviewWindow.getByLabel(HELP_WINDOW_LABEL)
  if (!existing) return
  lastTarget = null
  try {
    await existing.close()
  } catch (error) {
    logger.warn('Failed to close the help window', { error })
  }
}

/**
 * Pushes the App's resolved language into the open help window so its
 * UI copy follows a language switch live. Best-effort: no window, no
 * delivery, never a throw.
 */
export async function pushHelpLocale(locale: string): Promise<void> {
  try {
    await emitTo(HELP_WINDOW_LABEL, 'pnds:help-locale', { locale })
  } catch {
    // No live window to receive it — nothing to do.
  }
}

/**
 * Pushes the effective color theme into the open help window — an open
 * help center must never keep rendering a stale theme after the user
 * switches one in settings. Same best-effort contract as the locale.
 */
async function pushHelpTheme(colorTheme: ColorTheme): Promise<void> {
  try {
    await emitTo(HELP_WINDOW_LABEL, 'pnds:help-theme', { colorTheme })
  } catch {
    // No live window to receive it — nothing to do.
  }
}

/**
 * v1.3.0 (#56): the main-window side of the help center bridge.
 * Keeps an OPEN help window live-following the app: language switches
 * and Appearance theme changes are pushed as events — the page applies
 * the theme and, since #68, the locale drives a hot corpus swap (the
 * help window refetches that locale's tree and rebuilds its search
 * index; no reopen). And it closes the open-while-booting race: a
 * navigate event sent before the page registered its listener is
 * dropped, so the page announces `pnds:help-ready` once listening and
 * the last target is replayed — a rapid second menu click never
 * silently lands on the default page.
 *
 * Returns an unsubscribe for the caller's cleanup.
 */
export function setupHelpWindowBridge(): () => void {
  const onLanguage = () => {
    void pushHelpLocale(currentResolvedLanguage())
  }
  i18n.on('languageChanged', onLanguage)

  // The settings store is a plain Zustand create (no
  // subscribeWithSelector), so the slice filter is local — a push fires
  // only when the theme value actually changed, not on the store's
  // unrelated churn.
  let previousTheme = useSettingsStore.getState().colorThemeSetting
  const unsubTheme = useSettingsStore.subscribe(state => {
    if (state.colorThemeSetting === previousTheme) return
    previousTheme = state.colorThemeSetting
    void pushHelpTheme(previousTheme)
  })

  const offReady = listen('pnds:help-ready', () => {
    if (lastTarget === null) return
    void emitTo(HELP_WINDOW_LABEL, 'pnds:help-navigate', lastTarget).catch(
      () => {
        // The window closed in the same breath — nothing to replay.
      }
    )
  })

  return () => {
    i18n.off('languageChanged', onLanguage)
    unsubTheme()
    void offReady.then(unlisten => unlisten())
  }
}
