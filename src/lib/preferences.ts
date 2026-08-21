import { commands, type AppPreferences } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'

/**
 * THE app-local preferences module (§6.5, §6.6). Every preference write in
 * the app flows through here: a patch applied over the just-loaded state
 * inside one serialized queue. The persisted fields cover the app-side
 * project index (history + folders + names) and the audio/session
 * preferences — none of it ever touches project manifests.
 */

export const SYSTEM_DEFAULT_DEVICE = 'System default'

/** §6.6 default prefill for the external OSC target input. */
export const DEFAULT_OSC_TARGET = '127.0.0.1:3333'

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

export async function loadPreferences(): Promise<AppPreferences | null> {
  const result = await commands.loadPreferences()
  if (result.status === 'error') {
    logger.warn('Failed to load preferences', { error: result.error })
    return null
  }
  return result.data
}

/** The fields `updatePreferences` may patch; the legacy `theme` field
 * stays load-only (reserved for a future system light/dark follow). */
export type PreferencesPatch = Partial<
  Pick<
    AppPreferences,
    | 'language'
    | 'colorTheme'
    | 'sampleRate'
    | 'outputDevice'
    | 'recentProjects'
    | 'projectFolders'
    | 'projectDisplayNames'
    | 'projectManifestNames'
  >
>

/**
 * The one way preference fields are written. The map fields
 * (`projectDisplayNames`, `projectManifestNames`, `projectFolders`) are
 * whole-value commits: the project store holds the live maps and passes
 * the state it just committed, so a whole-map write cannot lose an update.
 */
export async function updatePreferences(
  patch: PreferencesPatch
): Promise<void> {
  return enqueueSave(async () => {
    const prefs = await loadPreferences()
    if (!prefs) return
    await commands.savePreferences({ ...prefs, ...patch })
  })
}

/**
 * §6.6: per-project OSC targets merge key-by-key inside the queue — no
 * store mirrors this map, so a whole-map write could clobber a concurrent
 * project's target.
 */
export async function updateOscTarget(
  projectId: string,
  target: string
): Promise<void> {
  return enqueueSave(async () => {
    const prefs = await loadPreferences()
    if (!prefs) return
    await commands.savePreferences({
      ...prefs,
      oscTargets: { ...prefs.oscTargets, [projectId]: target },
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
