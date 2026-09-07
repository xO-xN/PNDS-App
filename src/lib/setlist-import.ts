/**
 * v1.4.0 (issue #63): the setlist import flow — the receiving machine's
 * counterpart to the export (#59). A chosen export directory becomes a
 * rebuilt performance folder: every `.pnds` installs through the EXISTING
 * bundle install pipeline (`<id>-<version>` slot, same id+version always
 * reinstalls — no third install behavior), then one `replaceProjectIndex`
 * rebuilds history, the folder and its order, and the display names.
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
  setlistRebuild,
} from '@/lib/setlist'
import { newFolderId, useProjectStore } from '@/store/project-store'
import { setActiveFolderView } from '@/lib/project-select'

/**
 * Imports the setlist export directory `dir`. Returns true when the
 * directory WAS a setlist export and the flow handled it (a corrupt or
 * incomplete set reports its error and still counts as handled); false
 * when there is no set.json — the caller falls through to the normal
 * open flow.
 */
export async function importSetlistDirectory(dir: string): Promise<boolean> {
  const read = await commands.readSetlist(dir)
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

  notifications.info(
    i18n.t('setlist.importStart', {
      name: setlist.name,
      count: plan.files.length,
    })
  )

  // Set order drives install order; the existing install command is the
  // only install path (same slot + reinstall semantics as a single ⌘O
  // bundle open). A failed install aborts BEFORE the index rebuild —
  // installs are idempotent, so re-running the import heals.
  const installedPaths: string[] = []
  for (const file of plan.files) {
    const result = await commands.installBundle(file)
    if (result.status === 'error') {
      logger.error('Setlist bundle install failed', {
        file,
        error: result.error,
      })
      notifications.error(
        i18n.t('setlist.importFailed'),
        `${file}: ${result.error}`
      )
      return true
    }
    installedPaths.push(result.data)
  }

  // One wholesale rebuild: history, the folder (in set order under the
  // set's name) and the display-name overrides commit as one snapshot.
  // App content rides through; the batch bypasses the per-directory caps
  // exactly like legacy over-limit data (the v1.3.2 seam decision).
  const folderId = newFolderId()
  const { paths, folders, names } = setlistRebuild(
    setlist,
    installedPaths,
    folderId
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
  notifications.success(i18n.t('setlist.importSuccessTitle'), setlist.name)
  return true
}
