/**
 * v1.4.0 (issue #59): the setlist export flow — the folder-context
 * command behind the sidebar menu item. A performance folder becomes a
 * wholly-copyable directory: each member's `.pnds` (packed by the Rust
 * side into the chosen destination), a hand-editable `set.json`
 * (serialized by `setlist.ts`, which pins the schema) and a localized
 * import instructions `README.txt`. Machine-local preferences (audio
 * device, sample rate, node config) never travel with it.
 */

import { open } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { loadPreferences } from '@/lib/preferences'
import { projectDisplayName } from '@/lib/display-names'
import { isProtectedFolder, useProjectStore } from '@/store/project-store'
import {
  SETLIST_FORMAT_VERSION,
  duplicateSetlistIdentity,
  serializeSetlist,
  type SetlistProject,
} from '@/lib/setlist'

/** The localized import instructions written beside the bundles. */
function readmeText(folderName: string, projectCount: number): string {
  return [
    i18n.t('setlist.readmeHeading', { name: folderName }),
    '',
    i18n.t('setlist.readmeContents', { count: projectCount }),
    i18n.t('setlist.readmeImport'),
    '',
    i18n.t('setlist.readmeHandEdit'),
    i18n.t('setlist.readmeSingleBundle'),
    i18n.t('setlist.readmeLocalPrefs'),
    '',
  ].join('\n')
}

/**
 * Exports the folder `folderId` into a directory the operator picks:
 * describe (the packability gate + set.json inputs) → assemble + serialize
 * set.json → pack & write on the Rust side → success toast + Finder
 * reveal. Every abort except a mid-export failure leaves nothing written.
 */
export async function exportSetlistFolder(folderId: string): Promise<void> {
  const store = useProjectStore.getState()
  const folder = store.projectFolders.find(entry => entry.id === folderId)
  if (!folder || isProtectedFolder(folder.id)) return
  const paths = [...folder.projectPaths]
  if (paths.length === 0) return

  const destDir = await open({
    directory: true,
    multiple: false,
    title: i18n.t('sidebar.setlistPickTitle'),
  })
  if (destDir === null) return // cancelled — nothing happened

  // The describe step is also the gate: every member must pass the same
  // packability check a pack would run before anything is written.
  const info = await commands.getSetlistExportInfo(paths)
  if (info.status === 'error') {
    logger.error('Setlist export pre-flight failed', {
      folder: folder.name,
      error: info.error,
    })
    notifications.error(i18n.t('setlist.exportCheckFailed'), info.error)
    return
  }
  // Two paths exporting the same id+version would collide on one .pnds
  // and make the set ambiguous — refuse before writing.
  const duplicate = duplicateSetlistIdentity(info.data)
  if (duplicate !== null) {
    notifications.error(
      i18n.t('setlist.duplicateIdentity', { identity: duplicate })
    )
    return
  }
  // `.pnds` names derive from name+version, not the identity — two
  // distinct projects sharing them would silently overwrite each other's
  // bundle in the export directory.
  const fileNames = new Set<string>()
  for (const entry of info.data) {
    if (fileNames.has(entry.fileName)) {
      notifications.error(
        i18n.t('setlist.duplicateFileName', { file: entry.fileName })
      )
      return
    }
    fileNames.add(entry.fileName)
  }

  const prefs = await loadPreferences()
  const { projectDisplayNames, manifestProjectNames, currentProject } =
    useProjectStore.getState()
  const projects: SetlistProject[] = info.data.map(entry => ({
    file: entry.fileName,
    id: entry.id,
    version: entry.version,
    // The name the exported card showed — the app's one naming rule.
    displayName: projectDisplayName(
      entry.path,
      projectDisplayNames,
      manifestProjectNames,
      currentProject
    ),
    audioMode: entry.defaultAudioMode,
    // No saved external target = no field (hand editors read absence as
    // "unset", not "127.0.0.1:3333").
    ...(prefs?.oscTargets?.[entry.id]
      ? { oscTarget: prefs.oscTargets[entry.id] }
      : {}),
  }))
  const setlistJson = serializeSetlist({
    formatVersion: SETLIST_FORMAT_VERSION,
    name: folder.name,
    exportedWith: __APP_VERSION__,
    exportedAt: new Date().toISOString(),
    projects,
  })

  const result = await commands.exportSetlist(
    destDir,
    setlistJson,
    readmeText(folder.name, projects.length),
    paths
  )
  if (result.status === 'error') {
    logger.error('Setlist export failed', {
      folder: folder.name,
      dir: destDir,
      error: result.error,
    })
    notifications.error(i18n.t('setlist.exportFailed'), result.error)
    return
  }
  logger.info('Setlist exported', { folder: folder.name, dir: destDir })
  notifications.success(
    i18n.t('setlist.exportSuccessTitle'),
    result.data.outputDir
  )
  // Best effort — the export succeeded; a reveal hiccup is not an error.
  await revealItemInDir(result.data.outputDir).catch(error => {
    logger.warn('Failed to reveal the export directory', { error })
  })
}
