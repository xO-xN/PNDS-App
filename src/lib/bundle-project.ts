import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { openProject } from '@/lib/open-project'
import { useProjectStore, visibleProjectPaths } from '@/store/project-store'

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

let installQueue: Promise<void> = Promise.resolve()
const pendingInstalls = new Map<string, Promise<void>>()

/** Serialize installation/publication and join repeat requests for one source. */
export async function installAndOpenBundle(bundlePath: string): Promise<void> {
  const pending = pendingInstalls.get(bundlePath)
  if (pending) return pending
  const operation = installQueue.then(() => installBundleAndOpen(bundlePath))
  installQueue = operation.catch(() => undefined)
  pendingInstalls.set(bundlePath, operation)
  try {
    await operation
  } finally {
    if (pendingInstalls.get(bundlePath) === operation)
      pendingInstalls.delete(bundlePath)
  }
}

/** Installs a `.pnds` into `bundles/` and opens the extracted project. */
async function installBundleAndOpen(bundlePath: string): Promise<void> {
  const toastId = `bundle-install:${bundlePath}`
  notifications.flow.step(toastId, i18n.t('bundle.installing'), bundlePath)
  logger.info('Installing .pnds bundle', { path: bundlePath })
  try {
    const result = await commands.installBundle(bundlePath)
    if (result.status === 'error') throw new Error(result.error)
    notifications.flow.succeed(toastId, i18n.t('bundle.installed'), result.data)
    const store = useProjectStore.getState()
    if (
      store.recentProjectPaths.includes(result.data) &&
      !visibleProjectPaths(
        store.recentProjectPaths,
        store.projectFolders,
        store.activeFolderId
      ).includes(result.data)
    ) {
      // Reopening an existing install reveals its card without changing
      // folder membership. New installs still follow the normal import rule.
      const folder = store.projectFolders.find(folder =>
        folder.projectPaths.includes(result.data)
      )
      store.setActiveFolderId(folder?.id ?? null)
    }
    await openProject(result.data)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Bundle install failed', {
      path: bundlePath,
      error: message,
    })
    notifications.flow.fail(toastId, i18n.t('bundle.installFailed'), message)
  }
}

let bundleOpenQueue: Promise<void> = Promise.resolve()

/**
 * Atomically drains the queue of `.pnds` paths macOS asked the App to open
 * (double-click / launch-with-document) and installs each one. Every wakeup
 * joins one serialized chain: later events cannot install over an in-flight
 * batch or let an older selection finish after a newer document.
 */
export function drainPendingBundleOpens(): Promise<void> {
  const run = bundleOpenQueue.then(drainBundleQueue, drainBundleQueue)
  bundleOpenQueue = run
  return run
}

async function drainBundleQueue(): Promise<void> {
  try {
    const result = await commands.takePendingBundleOpens()
    if (result.status === 'error') throw new Error(result.error)
    for (const path of result.data) {
      await installAndOpenBundle(path)
    }
  } catch (error) {
    logger.warn('Failed to read pending bundle opens', { error })
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
