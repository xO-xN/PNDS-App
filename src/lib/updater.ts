/**
 * Updater lifecycle (v1.4.3, issue #121): check-only — the app never
 * downloads, installs, or relaunches. One module owns the check flow so
 * the manual entries (app menu, Settings About) and the boot auto-check
 * can only share it, never drift. Callers hand over rendering: outcomes
 * go to a UpdaterRenderer, and the toast renderers below draw the manual
 * feedback (the "available" toast's action opens the Releases page —
 * downloading is the operator's move, not the app's). The entry
 * renderers in src/store/updater-store.ts layer the persistence (the
 * starting page's notice) and the manual-path failure dialog on top.
 */
import { toast } from 'sonner'
import { check } from '@tauri-apps/plugin-updater'
import { openUrl } from '@tauri-apps/plugin-opener'
import i18n from '@/i18n/config'
import { logger } from '@/lib/logger'

/** Typed result of the check phase — and the whole lifecycle: check-only
 * (#121) means there is no install continuation to carry. */
export type UpdaterOutcome =
  | { kind: 'available'; version: string }
  | { kind: 'up-to-date' }
  | { kind: 'check-failed'; reason: string }

/**
 * Rendering seam for update outcomes. The lifecycle never touches UI
 * primitives; it hands each outcome to a renderer. The toast renderers
 * below are the manual path's vocabulary; the store renderers
 * (src/store/updater-store.ts) extend them with the persistent
 * available-state and the failure dialog.
 */
export interface UpdaterRenderer {
  /** An update is available; the renderer points the operator at it. */
  available(version: string): void
  upToDate(): void
  checkFailed(reason: string): void
}

/** The manual-download target — the repo the updater endpoint
 * (tauri.conf.json) checks, minus the manifest path. Exported for the
 * tests (dialog, starting page) to pin the target. */
export const RELEASES_URL = 'https://github.com/xO-xN/PNDS-App/releases'

/**
 * Open the Releases page — the single action every update surface offers
 * (the manual toast's action button, the starting page's notice, the
 * failure dialog's primary action). A failure falls back to a generic
 * toast, never an unhandled rejection.
 */
export async function openReleasesPage(): Promise<void> {
  try {
    await openUrl(RELEASES_URL)
  } catch (error) {
    logger.warn('Failed to open the releases page', { error })
    toast.error(i18n.t('toast.error.generic'))
  }
}

/** How long an actionable toast stays up — sonner's 4s default retires
 * the buttons before an operator can reach them. */
const ACTION_TOAST_DURATION_MS = 10_000

/** Error text for outcome reasons (toast bodies, not logs). */
function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

/**
 * The check phase: resolves to a typed outcome, never throws. The
 * plugin's Update object never leaves this module.
 */
export async function performUpdateCheck(): Promise<UpdaterOutcome> {
  logger.info('Checking for updates')
  try {
    const update = await check()
    if (!update) return { kind: 'up-to-date' }
    logger.info(`Update available: ${update.version}`)
    return { kind: 'available', version: update.version }
  } catch (error) {
    logger.error('Update check failed', { error })
    return { kind: 'check-failed', reason: errorText(error) }
  }
}

/** Check and render: every outcome branch lands on the renderer. */
async function runUpdateFlow(renderer: UpdaterRenderer): Promise<void> {
  const outcome = await performUpdateCheck()
  switch (outcome.kind) {
    case 'available':
      renderer.available(outcome.version)
      break
    case 'up-to-date':
      renderer.upToDate()
      break
    case 'check-failed':
      renderer.checkFailed(outcome.reason)
      break
  }
}

/**
 * Manual entry (app menu item, Settings About button): full feedback —
 * every outcome renders. The production callers pass the store's
 * manualCheckRenderer (persistence + failure dialog); the toast renderer
 * below is the default and the vocabulary base.
 */
export function checkForUpdates(
  renderer: UpdaterRenderer = manualToastRenderer
): void {
  void runUpdateFlow(renderer)
}

/** Boot auto-check delay — the app settles before the network is touched. */
export const BOOT_UPDATE_CHECK_DELAY_MS = 5000

/**
 * Boot entry: schedules the same check 5s after launch and returns its
 * cancel (App.tsx wires that into the effect cleanup). The production
 * caller passes the store's bootCheckRenderer; the quiet renderer below
 * is the default.
 */
export function startBootUpdateCheck(
  renderer: UpdaterRenderer = bootQuietRenderer
): () => void {
  const timer = setTimeout(
    () => void runUpdateFlow(renderer),
    BOOT_UPDATE_CHECK_DELAY_MS
  )
  return () => clearTimeout(timer)
}

/** Manual-path toast renderer: feedback for every outcome; the
 * "available" toast's action opens the Releases page. */
export const manualToastRenderer: UpdaterRenderer = {
  available(version) {
    toast.info(i18n.t('updater.availableTitle'), {
      description: i18n.t('updater.availableBody', { version }),
      duration: ACTION_TOAST_DURATION_MS,
      action: {
        label: i18n.t('updater.releasesAction'),
        onClick: () => void openReleasesPage(),
      },
    })
  },
  upToDate() {
    toast.success(i18n.t('updater.upToDateTitle'), {
      description: i18n.t('updater.upToDateBody'),
    })
  },
  checkFailed(reason) {
    toast.error(i18n.t('updater.checkFailedTitle'), {
      description: i18n.t('updater.checkFailedBody', { reason }),
    })
  },
}

/** Boot-path renderer: completely quiet — a venue machine that cannot
 * reach GitHub must never see a dialog or toast about it (the lifecycle
 * has already logged the failure itself). Production wires the store's
 * bootCheckRenderer, which only adds the persisted available-state. */
export const bootQuietRenderer: UpdaterRenderer = {
  available(version) {
    logger.debug(`Boot update check: ${version} available`)
  },
  upToDate: () => {
    logger.debug('Boot update check: up to date')
  },
  checkFailed: reason => {
    logger.debug('Boot update check failed (silent)', { reason })
  },
}
