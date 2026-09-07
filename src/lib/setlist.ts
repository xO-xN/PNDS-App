/**
 * v1.4.0 (issue #59): the `set.json` exchange format for setlist exports
 * (spec #57). An exported directory holds each project's `.pnds` (packer
 * name `<sanitized name>-<version>.pnds`), this `set.json`, and an import
 * instructions `README.txt` written by the Rust side.
 *
 * **The schema is pinned here** (mirrored by the Rust writer's file layout
 * and `docs/developer/setlist.md`; do not change fields without a
 * formatVersion bump):
 *
 * ```jsonc
 * {
 *   "formatVersion": 1,            // this schema's version
 *   "name": "Gig Berlin",          // the performance folder's name
 *   "exportedWith": "1.4.0",       // App version that produced the export
 *   "exportedAt": "2026-09-07T12:00:00.000Z", // RFC 3339
 *   "projects": [                  // folder order — the set's order
 *     {
 *       "file": "Inarticulate III-0.1.0.pnds", // sibling .pnds hint
 *       "id": "inarticulate-iii",  // manifest identity —
 *       "version": "0.1.0",        //   NEVER a path (installs move machines)
 *       "displayName": "Opening Set", // the listing name the card showed
 *       "audioMode": "external",   // manifest-declared default audio mode
 *       "oscTarget": "10.0.0.5:3333" // saved external target; omit = unset
 *     }
 *   ]
 * }
 * ```
 *
 * `file` is informational — identity is always `id` + `version`, so a
 * hand-renamed bundle still matches (the import resolves identities from
 * the directory's `.pnds` files). `displayName`/`audioMode`/`oscTarget`
 * are optional for hand editing; the exporter always writes them.
 * Machine-local preferences (audio device, sample rate, theme, node
 * config) never travel — devices live on the receiving machine.
 */

/** The setlist's manifest file inside an export directory. */
export const SETLIST_FILE_NAME = 'set.json'

/** The set.json schema version this App writes and reads. */
export const SETLIST_FORMAT_VERSION = 1

export interface SetlistProject {
  /** Sibling `.pnds` file name — a hint; identity is id + version. */
  file?: string
  /** Manifest `id`. */
  id: string
  /** Manifest `version`. */
  version: string
  /** The listing name the exported card showed. */
  displayName?: string
  /** Manifest-declared default audio mode. */
  audioMode?: string
  /** Saved external OSC target (`host:port`); absent = never set. */
  oscTarget?: string
}

export interface SetlistFile {
  formatVersion: number
  /** The performance folder's name. */
  name: string
  /** App version that produced the export. */
  exportedWith: string
  /** RFC 3339 timestamp of the export. */
  exportedAt: string
  /** The set's projects, in folder order. */
  projects: SetlistProject[]
}

/**
 * Serializes a setlist as hand-editable JSON: 2-space pretty printing,
 * the pinned key order (JSON.stringify keeps insertion order), absent
 * optionals omitted, one trailing newline.
 */
export function serializeSetlist(setlist: SetlistFile): string {
  return `${JSON.stringify(setlist, null, 2)}\n`
}

export type SetlistParseResult =
  | { ok: true; setlist: SetlistFile }
  | { ok: false; error: string }

/** The first duplicated `id version` identity, or null when all differ. */
export function duplicateSetlistIdentity(
  projects: readonly Pick<SetlistProject, 'id' | 'version'>[]
): string | null {
  const seen = new Set<string>()
  for (const project of projects) {
    const key = JSON.stringify([project.id, project.version])
    if (seen.has(key)) return `${project.id} ${project.version}`
    seen.add(key)
  }
  return null
}

/**
 * Parses and validates a set.json body for the import (#63). Unknown keys
 * are ignored (hand editors add notes); known fields must hold the right
 * shapes, the format version must be one this App reads, and a project
 * identity may appear once. Errors are readable strings for the UI.
 */
export function parseSetlist(text: string): SetlistParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (error) {
    return err(`set.json is not valid JSON: ${stringifyError(error)}`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return err('set.json must contain a JSON object')
  }
  const body = raw as Record<string, unknown>

  if (body.formatVersion !== SETLIST_FORMAT_VERSION) {
    return err(
      `Unsupported set.json formatVersion ${String(body.formatVersion)} (this App reads ${SETLIST_FORMAT_VERSION})`
    )
  }
  if (!nonEmptyString(body.name)) {
    return err('set.json "name" must be a non-empty string')
  }
  if (!Array.isArray(body.projects)) {
    return err('set.json "projects" must be an array')
  }

  const projects: SetlistProject[] = []
  for (const entry of body.projects) {
    if (typeof entry !== 'object' || entry === null) {
      return err('Every set.json project must be an object')
    }
    const project = entry as Record<string, unknown>
    if (!nonEmptyString(project.id)) {
      return err('Every set.json project needs a non-empty string "id"')
    }
    if (!nonEmptyString(project.version)) {
      return err(
        `Project "${String(project.id)}" needs a non-empty string "version"`
      )
    }
    const parsed: SetlistProject = {
      id: project.id,
      version: project.version,
    }
    const file = optionalString(project.file)
    if (file !== undefined) parsed.file = file
    const displayName = optionalString(project.displayName)
    if (displayName !== undefined) parsed.displayName = displayName
    const audioMode = optionalString(project.audioMode)
    if (audioMode !== undefined) parsed.audioMode = audioMode
    const oscTarget = optionalString(project.oscTarget)
    if (oscTarget !== undefined) parsed.oscTarget = oscTarget
    projects.push(parsed)
  }

  const duplicate = duplicateSetlistIdentity(projects)
  if (duplicate !== null) {
    return err(`set.json lists the project "${duplicate}" twice`)
  }

  return {
    ok: true,
    setlist: {
      formatVersion: SETLIST_FORMAT_VERSION,
      name: body.name,
      // Informational stamps — hand editors may drop them.
      exportedWith: optionalString(body.exportedWith) ?? '',
      exportedAt: optionalString(body.exportedAt) ?? '',
      projects,
    },
  }
}

function err(error: string): SetlistParseResult {
  return { ok: false, error }
}

function nonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0
}

/** A string, or undefined for anything else (null, absent, wrong type). */
function optionalString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function stringifyError(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}
