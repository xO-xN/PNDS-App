import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { openProject } from '@/lib/open-project'

/**
 * v1.2.0 (issue #16): `.pnds` bundle open flows. A bundle is a transport
 * container — installing extracts it into the app-managed `bundles/`
 * directory (same id+version always reinstalls), after which the extracted
 * directory goes through the exact same open flow as a directory project.
 */

/**
 * True for `.pnds` bundle files (case-insensitive extension) — the routing
 * check shared by the ⌘O picker and the Finder drag-and-drop.
 */
export function isBundlePath(path: string): boolean {
  return path.toLowerCase().endsWith('.pnds')
}

/** Installs a `.pnds` into `bundles/` and opens the extracted project. */
export async function installAndOpenBundle(bundlePath: string): Promise<void> {
  logger.info('Installing .pnds bundle', { path: bundlePath })
  const result = await commands.installBundle(bundlePath)
  if (result.status === 'error') {
    logger.error('Bundle install failed', {
      path: bundlePath,
      error: result.error,
    })
    notifications.error(i18n.t('bundle.installFailed'), result.error)
    return
  }
  await openProject(result.data)
}

/**
 * Atomically drains the queue of `.pnds` paths macOS asked the App to open
 * (double-click / launch-with-document) and installs each one. Called both
 * from the live `pnds:open-bundle` event and once at mount — the backend's
 * take-and-clear semantics make the double trigger safe.
 */
export async function drainPendingBundleOpens(): Promise<void> {
  const result = await commands.takePendingBundleOpens()
  if (result.status === 'error') {
    logger.warn('Failed to read pending bundle opens', { error: result.error })
    return
  }
  for (const path of result.data) {
    await installAndOpenBundle(path)
  }
}

/**
 * History removal (sidebar ✕ / settings Projects) calls this for every
 * removed path: bundle installs under the app-managed `bundles/` directory
 * are reclaimed with it, everything on the user's disk is untouched. Best
 * effort — the index removal itself never fails because of this.
 */
export async function reclaimIfManagedBundle(path: string): Promise<void> {
  const result = await commands.reclaimProjectBundle(path)
  if (result.status === 'error') {
    logger.warn('Bundle reclaim failed', { path, error: result.error })
    return
  }
  if (result.data) {
    logger.info('Reclaimed bundle install directory', { path })
  }
}
