/**
 * Updater lifecycle (v1.3.2, issue #74): one module owns the whole update
 * flow — check → typed outcome → download/install → restart — so the manual
 * entries (app menu, Settings About) and the boot auto-check can only share
 * it, never drift. Callers hand over rendering: outcomes go to a
 * UpdaterRenderer, and the default renderer draws toasts (the "available"
 * toast carries the install action — the old native confirm()/alert()s are
 * retired). v1.4.0's App-styled failure dialog (spec #57 item 4) plugs in
 * as a second renderer without touching this lifecycle.
 */
import { toast } from 'sonner'
import { check, type Update } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import i18n from '@/i18n/config'
import { logger } from '@/lib/logger'

/** Typed result of the check phase. `install` continues the lifecycle
 * (download + install) and reports its own typed result. */
export type UpdaterOutcome =
  | {
      kind: 'available'
      version: string
      install: () => Promise<UpdaterInstallOutcome>
    }
  | { kind: 'up-to-date' }
  | { kind: 'check-failed'; reason: string }

/** Typed result of download + install. `restart` relaunches into the new
 * version; the renderer decides whether and how to offer it. */
export type UpdaterInstallOutcome =
  | { kind: 'installed'; restart: () => Promise<void> }
  | { kind: 'install-failed'; reason: string }

/**
 * Rendering seam for update outcomes. The lifecycle never touches UI
 * primitives; it hands each outcome (and the action that continues the
 * flow — installing, restarting) to a renderer. The toast renderers below
 * are the first implementation; v1.4.0's App-styled failure dialog
 * (spec #57 item 4) becomes a second one.
 */
export interface UpdaterRenderer {
  /** An update is available; `install` runs download + install. */
  available(version: string, install: () => void): void
  upToDate(): void
  checkFailed(reason: string): void
  /** Download + install finished; `restart` relaunches the app. */
  installed(restart: () => void): void
  installFailed(reason: string): void
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
 * `available` outcome carries the install continuation so the plugin's
 * Update object stays inside this module.
 */
export async function performUpdateCheck(): Promise<UpdaterOutcome> {
  logger.info('Checking for updates')
  try {
    const update = await check()
    if (!update) return { kind: 'up-to-date' }
    logger.info(`Update available: ${update.version}`)
    return {
      kind: 'available',
      version: update.version,
      install: () => downloadAndInstall(update),
    }
  } catch (error) {
    logger.error('Update check failed', { error })
    return { kind: 'check-failed', reason: errorText(error) }
  }
}

async function downloadAndInstall(
  update: Update
): Promise<UpdaterInstallOutcome> {
  try {
    await update.downloadAndInstall(event => {
      switch (event.event) {
        case 'Started':
          logger.info(`Downloading ${event.data.contentLength} bytes`)
          break
        case 'Progress':
          logger.info(`Downloaded: ${event.data.chunkLength} bytes`)
          break
        case 'Finished':
          logger.info('Download complete, installing...')
          break
      }
    })
    return { kind: 'installed', restart: () => relaunch() }
  } catch (error) {
    logger.error('Update installation failed', { error })
    return { kind: 'install-failed', reason: errorText(error) }
  }
}

/** Continuation the renderers trigger: run the install, then hand its
 * result back (installed → restart action; failed → reason). A restart
 * failure lands on the same failure render — the old flow alerted it
 * under its generic "Update failed" too. */
function runInstallFlow(
  install: () => Promise<UpdaterInstallOutcome>,
  renderer: UpdaterRenderer
): void {
  void install().then(result => {
    if (result.kind === 'installed') {
      renderer.installed(
        () =>
          void result.restart().catch(error => {
            logger.error('Update restart failed', { error })
            renderer.installFailed(errorText(error))
          })
      )
    } else {
      renderer.installFailed(result.reason)
    }
  })
}

/** Check and render: every outcome branch lands on the renderer. */
async function runUpdateFlow(renderer: UpdaterRenderer): Promise<void> {
  const outcome = await performUpdateCheck()
  switch (outcome.kind) {
    case 'available':
      renderer.available(outcome.version, () =>
        runInstallFlow(outcome.install, renderer)
      )
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
 * Manual entry (v1.2.0 issue #13 callers unchanged): the app menu item and
 * the Settings About button. Every outcome is rendered — including the
 * up-to-date confirmation and check failures the boot path stays quiet on.
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
 * cancel (App.tsx wires that into the effect cleanup).
 */
export function startBootUpdateCheck(
  renderer: UpdaterRenderer = bootToastRenderer
): () => void {
  const timer = setTimeout(
    () => void runUpdateFlow(renderer),
    BOOT_UPDATE_CHECK_DELAY_MS
  )
  return () => clearTimeout(timer)
}

/** Manual-path renderer: toasts for every outcome; the "available" and
 * "installed" toasts carry their flow-continuing action buttons. */
export const manualToastRenderer: UpdaterRenderer = {
  available(version, install) {
    toast.info(i18n.t('updater.availableTitle'), {
      description: i18n.t('updater.availableBody', { version }),
      duration: ACTION_TOAST_DURATION_MS,
      action: { label: i18n.t('updater.installAction'), onClick: install },
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
  installed(restart) {
    toast.success(i18n.t('updater.installedTitle'), {
      description: i18n.t('updater.installedBody'),
      duration: ACTION_TOAST_DURATION_MS,
      action: { label: i18n.t('updater.restartAction'), onClick: restart },
    })
  },
  installFailed(reason) {
    toast.error(i18n.t('updater.installFailedTitle'), {
      description: i18n.t('updater.installFailedBody', { reason }),
    })
  },
}

/** Boot-path renderer: same actionable toasts once an update exists, but
 * a quiet "no news" path — up-to-date and check failures (typically
 * transient network issues at boot) render nothing, only a debug trace.
 * The lifecycle has already logged the failure itself. */
export const bootToastRenderer: UpdaterRenderer = {
  ...manualToastRenderer,
  upToDate: () => {
    logger.debug('Boot update check: up to date')
  },
  checkFailed: reason => {
    logger.debug('Boot update check failed (silent)', { reason })
  },
}
