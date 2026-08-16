import {
  commands,
  type AppPreferences,
  type ProjectFolder,
} from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'

/**
 * App-local audio preferences (§6.5, §6.6): output device and per-project
 * OSC targets. Never written to project manifests.
 */
export const SYSTEM_DEFAULT_DEVICE = 'System default'

/** §6.6 default prefill for the external OSC target input. */
export const DEFAULT_OSC_TARGET = '127.0.0.1:3333'

/**
 * Preference saves are load-modify-write cycles over one file; overlapping
 * saves would clobber each other's fields. Serialize them so each save
 * reloads the just-written state.
 */
let saveQueue: Promise<unknown> = Promise.resolve()

function enqueueSave(save: () => Promise<void>): Promise<void> {
  // `save` runs as both fulfill and rejection handler: a failed save must
  // still hand the queue to the next one instead of stalling it.
  const run = saveQueue.then(save, save)
  saveQueue = run.catch(() => undefined)
  return run
}

export async function loadAudioPreferences(): Promise<AppPreferences | null> {
  const result = await commands.loadPreferences()
  if (result.status === 'error') {
    logger.warn('Failed to load audio preferences', { error: result.error })
    return null
  }
  return result.data
}

export async function saveOutputDevice(device: string | null): Promise<void> {
  return enqueueSave(async () => {
    const prefs = await loadAudioPreferences()
    if (!prefs) return
    await commands.savePreferences({ ...prefs, outputDevice: device })
  })
}

export async function saveOscTarget(
  projectId: string,
  target: string
): Promise<void> {
  return enqueueSave(async () => {
    const prefs = await loadAudioPreferences()
    if (!prefs) return
    await commands.savePreferences({
      ...prefs,
      oscTargets: { ...prefs.oscTargets, [projectId]: target },
    })
  })
}

/** §4.1: persist trusted project paths across launches. */
export async function saveRecentProjects(paths: string[]): Promise<void> {
  return enqueueSave(async () => {
    const prefs = await loadAudioPreferences()
    if (!prefs) return
    await commands.savePreferences({ ...prefs, recentProjects: paths })
  })
}

/**
 * v1.1.2: persist the app-side project index — trust list and folder
 * structure — in a single save. Removing a card changes both (the master
 * list and folder membership), so they must never race.
 */
export async function saveProjectIndex(
  paths: string[],
  folders: ProjectFolder[]
): Promise<void> {
  return enqueueSave(async () => {
    const prefs = await loadAudioPreferences()
    if (!prefs) return
    await commands.savePreferences({
      ...prefs,
      recentProjects: paths,
      projectFolders: folders,
    })
  })
}

/** §6.6 validation, mirroring the Rust rule: `host:port`, port 1-65535. */
export function isValidOscTarget(target: string): boolean {
  const idx = target.lastIndexOf(':')
  if (idx <= 0) return false
  const host = target.slice(0, idx)
  const port = Number(target.slice(idx + 1))
  return (
    host.trim().length > 0 &&
    !/\s/.test(host) &&
    Number.isInteger(port) &&
    port >= 1 &&
    port <= 65535
  )
}
