import {
  commands,
  type AppPreferences,
  type ProjectFolder,
} from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { upsertDisplayName } from '@/lib/display-names'

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

/**
 * v1.1.2 T6: persist one project display-name override (spec issue #10).
 * An empty name removes the entry — the card falls back to the
 * path-basename name.
 */
export async function saveProjectDisplayName(
  path: string,
  name: string
): Promise<void> {
  return enqueueSave(async () => {
    const prefs = await loadAudioPreferences()
    if (!prefs) return
    await commands.savePreferences({
      ...prefs,
      projectDisplayNames: upsertDisplayName(
        prefs.projectDisplayNames,
        path,
        name
      ),
    })
  })
}

/**
 * v1.2.0 (issue #16): persist the manifest-declared name learned at a
 * successful preflight. It becomes the listing name for every history
 * entry (a user override always wins; see display-names.ts).
 */
export async function saveProjectManifestName(
  path: string,
  name: string
): Promise<void> {
  return saveProjectManifestNames({ [path]: name })
}

/**
 * v1.2.0 (issue #18): persist a batch of manifest-declared names in one
 * save — the Utilities seeding learns every built-in tool's name up front,
 * before any of them has been opened.
 */
export async function saveProjectManifestNames(
  names: Record<string, string>
): Promise<void> {
  return enqueueSave(async () => {
    const prefs = await loadAudioPreferences()
    if (!prefs) return
    const merged = { ...prefs.projectManifestNames }
    for (const [path, name] of Object.entries(names)) {
      if (name) merged[path] = name
    }
    await commands.savePreferences({
      ...prefs,
      projectManifestNames: merged,
    })
  })
}

/**
 * v1.2.0 (issue #13): persist the General-section language choice. `null`
 * means "follow the system locale" — the pre-selection default.
 */
export async function saveLanguagePreference(
  language: string | null
): Promise<void> {
  return enqueueSave(async () => {
    const prefs = await loadAudioPreferences()
    if (!prefs) return
    await commands.savePreferences({ ...prefs, language })
  })
}

/** Issue #20: the rate an unset sample-rate preference resolves to —
 * mirrors `DEFAULT_SAMPLE_RATE` in Rust. The Audio section's selected
 * value when the user has never chosen. */
export const DEFAULT_SAMPLE_RATE = 48000

/** Issue #21: the fixed list the Audio section offers while the
 * device-capability query is in flight or failed — mirrors
 * `STANDARD_SAMPLE_RATES` in Rust (the backend already degrades to it when
 * enumeration fails or finds nothing). */
export const FALLBACK_SAMPLE_RATES: readonly number[] = [
  44100, 48000, 88200, 96000,
]

/**
 * Issue #21: persist the Settings Audio-section sample-rate choice. The
 * rate only ever applies at the next project start — mid-session changes
 * are impossible (the control is disabled while a session runs).
 */
export async function saveSampleRatePreference(rate: number): Promise<void> {
  return enqueueSave(async () => {
    const prefs = await loadAudioPreferences()
    if (!prefs) return
    await commands.savePreferences({ ...prefs, sampleRate: rate })
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
