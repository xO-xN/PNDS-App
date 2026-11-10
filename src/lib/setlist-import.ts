/**
 * v1.4.0 (issue #63): the setlist import flow — the receiving machine's
 * counterpart to the export (#59). A chosen export directory becomes a
 * rebuilt performance folder: every `.pnds` installs through the EXISTING
 * bundle install pipeline (`<id>-<version>` slot, same id+version always
 * reinstalls — no third install behavior), then one `replaceProjectIndex`
 * rebuilds history, the folder and its order, the display names, and the
 * folder's 自述 parsed back out of the export's README.md (#126 — a
 * pre-v1.5.0 export carries none, so the intro lands on its empty state).
 * Machine-local preferences never travel; the per-project external OSC
 * targets are the one setting set.json carries, merged back key-by-key.
 */

import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { isValidOscTarget, updateOscTarget } from '@/lib/preferences'
import {
  matchSetlistBundles,
  parseSetlist,
  parseIntroFromSetlistReadme,
  setlistRebuild,
} from '@/lib/setlist'
import { newFolderId, useProjectStore } from '@/store/project-store'
import { setActiveFolderView } from '@/lib/project-select'

let importQueue: Promise<unknown> = Promise.resolve()
const pendingImports = new Map<string, Promise<boolean>>()

/**
 * Imports the setlist export directory `dir`. Returns true when the
 * directory WAS a setlist export and the flow handled it (a corrupt or
 * incomplete set reports its error and still counts as handled); false
 * when there is no set.json — the caller falls through to the normal
 * open flow.
 */
export async function importSetlistDirectory(dir: string): Promise<boolean> {
  const pending = pendingImports.get(dir)
  if (pending) return pending
  const operation = importQueue.then(() => readAndImportSetlist(dir))
  importQueue = operation.catch(() => undefined)
  pendingImports.set(dir, operation)
  try {
    return await operation
  } finally {
    if (pendingImports.get(dir) === operation) pendingImports.delete(dir)
  }
}

async function readAndImportSetlist(dir: string): Promise<boolean> {
  let read: Awaited<ReturnType<typeof commands.readSetlist>>
  try {
    read = await commands.readSetlist(dir)
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Setlist read failed', { dir, error: message })
    notifications.flow.fail(
      `setlist-import:${dir}`,
      i18n.t('setlist.importFailed'),
      message
    )
    return true
  }
  if (read.status === 'error') {
    // Not a setlist export (or unreadable) — the caller's normal flow
    // reports its own error for a bad directory.
    return false
  }

  const parsed = parseSetlist(read.data.setlistJson)
  if (!parsed.ok) {
    logger.error('Setlist set.json is invalid', { dir, error: parsed.error })
    notifications.error(i18n.t('setlist.importParseFailed'), parsed.error)
    return true
  }
  const setlist = parsed.setlist

  const plan = matchSetlistBundles(setlist.projects, read.data.bundles)
  if (plan.missing.length > 0) {
    logger.error('Setlist bundles missing', { dir, missing: plan.missing })
    notifications.error(
      i18n.t('setlist.importMissing'),
      plan.missing.join(i18n.t('setlist.importMissingSeparator'))
    )
    return true
  }

  const toastId = `setlist-import:${dir}`
  notifications.flow.step(
    toastId,
    i18n.t('setlist.importStartTitle'),
    i18n.t('setlist.importStart', {
      name: setlist.name,
      count: plan.files.length,
    })
  )

  // Set order drives install order; the existing install command is the
  // only install path (same slot + reinstall semantics as a single ⌘O
  // bundle open). A failed install aborts BEFORE the index rebuild —
  // installs are idempotent, so re-running the import heals.
  try {
    const installedPaths: string[] = []
    for (const file of plan.files) {
      notifications.flow.step(
        toastId,
        i18n.t('setlist.importStartTitle'),
        i18n.t('setlist.importProgressItem', {
          current: installedPaths.length + 1,
          total: plan.files.length,
          name: file.split('/').at(-1) ?? file,
        })
      )
      const result = await commands.installBundle(file)
      if (result.status === 'error') throw new Error(`${file}: ${result.error}`)
      installedPaths.push(result.data)
    }
    notifications.flow.step(
      toastId,
      i18n.t('setlist.importStartTitle'),
      i18n.t('setlist.importProgressFinishing')
    )

    // One wholesale rebuild: history, the folder (in set order under the
    // set's name, with the 自述 parsed back out of README.md — #126) and
    // the display-name overrides commit as one snapshot. App content rides
    // through; the batch bypasses the per-directory caps exactly like
    // legacy over-limit data (the v1.3.2 seam decision).
    const folderId = newFolderId()
    const { paths, folders, names } = setlistRebuild(
      setlist,
      installedPaths,
      folderId,
      parseIntroFromSetlistReadme(read.data.readme)
    )
    useProjectStore.getState().replaceProjectIndex(paths, folders, names)

    // The one setting that travels: per-project external OSC targets,
    // merged key-by-key. Hand-edited garbage is refused here rather than
    // persisted into the injection seam.
    for (const project of setlist.projects) {
      if (project.oscTarget && isValidOscTarget(project.oscTarget)) {
        await updateOscTarget(project.id, project.oscTarget)
      } else if (project.oscTarget) {
        logger.warn('Skipping an invalid set.json oscTarget', {
          id: project.id,
          target: project.oscTarget,
        })
      }
    }

    // Land the sidebar inside the rebuilt folder — the import is visible
    // as the ordered set, immediately.
    setActiveFolderView(folderId)
    logger.info('Setlist imported', {
      dir,
      folder: setlist.name,
      count: paths.length,
    })
    notifications.flow.succeed(
      toastId,
      i18n.t('setlist.importSuccessTitle'),
      setlist.name
    )
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logger.error('Setlist import failed', { dir, error: message })
    notifications.flow.fail(toastId, i18n.t('setlist.importFailed'), message)
  }
  return true
}
