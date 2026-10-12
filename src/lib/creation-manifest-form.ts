import type { AudioMode } from '@/lib/tauri-bindings'

/**
 * #158: the manifest form is a pure view over the shared draft text. These
 * helpers parse that text into editable field values and write single-field
 * edits back by re-serializing the parsed JSON object, so unrecognized
 * fields (scoreServer.routes, roles, legacy sampleRate, …) survive every
 * round-trip untouched. Save-time schema enforcement lives at the Rust
 * save boundary; these helpers only keep the draft parseable.
 */

export const MANIFEST_MODES: AudioMode[] = ['internal', 'external', 'none']

export interface ManifestFormModel {
  name: string
  id: string
  version: string
  description: string
  defaultMode: AudioMode | ''
  supportedModes: AudioMode[]
  outputChannels: string
  audioBusChannels: string
  blockSize: string
  synthdefs: string
  entry: string
  workingDirectory: string
  monitorPort: string
  performerPort: string
  telematic: boolean
  performerAddress: string
  standaloneTarget: string
}

export type ManifestFormField = Exclude<
  keyof ManifestFormModel,
  'supportedModes'
>

const FIELD_PATHS: Record<ManifestFormField, string[]> = {
  name: ['name'],
  id: ['id'],
  version: ['version'],
  description: ['description'],
  defaultMode: ['audio', 'defaultMode'],
  outputChannels: ['audio', 'outputChannels'],
  audioBusChannels: ['audio', 'scsynth', 'audioBusChannels'],
  blockSize: ['audio', 'scsynth', 'blockSize'],
  synthdefs: ['audio', 'synthdefs'],
  entry: ['scoreServer', 'entry'],
  workingDirectory: ['scoreServer', 'workingDirectory'],
  monitorPort: ['scoreServer', 'monitorPort'],
  performerPort: ['scoreServer', 'performerPort'],
  telematic: ['telematic'],
  performerAddress: ['performerAddress'],
  standaloneTarget: ['audio', 'standaloneTarget'],
}

type JsonObject = Record<string, unknown>

function asObject(value: unknown): JsonObject | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : null
}

/** The parsed draft as a mutable object, or null when the text is not a
 * JSON *object* (unparseable, array or scalar). */
function parseDraftObject(text: string): JsonObject | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    return null
  }
  return asObject(parsed)
}

function branch(root: JsonObject, path: string[]): JsonObject {
  let node = root
  for (const key of path) {
    const existing = asObject(node[key])
    if (existing) node = existing
    else {
      const created: JsonObject = {}
      node[key] = created
      node = created
    }
  }
  return node
}

function displayString(value: unknown): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : ''
}

function displayNumber(value: unknown, fallback = ''): string {
  return typeof value === 'number' ? String(value) : fallback
}

/** Parses draft text into field values; null when the text is not a JSON
 * *object* (unparseable, array or scalar) and only the text view can edit. */
export function parseManifestFormModel(text: string): ManifestFormModel | null {
  const root = parseDraftObject(text)
  if (!root) return null
  const scoreServer = asObject(root.scoreServer) ?? {}
  const audio = asObject(root.audio) ?? {}
  const scsynth = asObject(audio.scsynth) ?? {}
  const supportedModes = Array.isArray(audio.supportedModes)
    ? [
        ...new Set(
          audio.supportedModes.filter((mode): mode is AudioMode =>
            MANIFEST_MODES.includes(mode as AudioMode)
          )
        ),
      ]
    : []
  return {
    name: displayString(root.name),
    id: displayString(root.id),
    version: displayString(root.version),
    description: displayString(root.description),
    defaultMode: MANIFEST_MODES.includes(audio.defaultMode as AudioMode)
      ? (audio.defaultMode as AudioMode)
      : '',
    supportedModes,
    outputChannels: displayNumber(audio.outputChannels, '2'),
    audioBusChannels: displayNumber(scsynth.audioBusChannels),
    blockSize: displayNumber(scsynth.blockSize),
    synthdefs: Array.isArray(audio.synthdefs)
      ? audio.synthdefs
          .map(line => displayString(line))
          .filter(Boolean)
          .join('\n')
      : '',
    entry: displayString(scoreServer.entry),
    workingDirectory: displayString(scoreServer.workingDirectory),
    monitorPort: displayNumber(scoreServer.monitorPort),
    performerPort: displayNumber(scoreServer.performerPort),
    telematic: root.telematic === true,
    performerAddress: displayString(root.performerAddress),
    standaloneTarget: displayString(audio.standaloneTarget),
  }
}

function removeAt(root: JsonObject, path: string[]) {
  const key = path.at(-1)
  if (key !== undefined)
    Reflect.deleteProperty(branch(root, path.slice(0, -1)), key)
}

function setAt(root: JsonObject, path: string[], value: unknown) {
  const key = path.at(-1)
  if (key !== undefined) branch(root, path.slice(0, -1))[key] = value
}

function isBlank(value: string): boolean {
  return value.trim() === ''
}

function isBlankString(value: string | boolean): value is string {
  return typeof value === 'string' && isBlank(value)
}

function positiveInt(value: string | boolean): number | null {
  if (typeof value !== 'string') return null
  return /^\d+$/.test(value.trim()) ? Number(value.trim()) : null
}

/** Writes one field edit into the draft text and returns the serialized
 * result; null when the current text is not an editable JSON object. */
export function writeManifestField(
  text: string,
  field: ManifestFormField,
  value: string | boolean
): string | null {
  const root = parseDraftObject(text)
  if (!root) return null
  const path = FIELD_PATHS[field]
  switch (field) {
    case 'name':
    case 'id':
    case 'version':
    case 'entry':
    case 'workingDirectory':
      // Contract-required identity strings stay writable even when blank;
      // the save gate reports them if the schema rejects the result.
      setAt(root, path, value)
      break
    case 'description':
    case 'performerAddress':
    case 'standaloneTarget':
      if (isBlankString(value)) removeAt(root, path)
      else setAt(root, path, value)
      break
    case 'outputChannels':
    case 'audioBusChannels':
    case 'blockSize':
    case 'monitorPort':
    case 'performerPort': {
      const number = positiveInt(value)
      if (number === null) removeAt(root, path)
      else setAt(root, path, number)
      break
    }
    case 'defaultMode':
      setAt(root, path, value)
      break
    case 'telematic':
      // Only an explicit declaration counts (manifest.md); clearing the
      // checkbox returns the project to undeclared, not `false`.
      if (value === true) setAt(root, path, true)
      else removeAt(root, path)
      break
    case 'synthdefs': {
      const artifacts = (value as string)
        .split('\n')
        .map(line => line.trim())
        .filter(Boolean)
      if (artifacts.length === 0) removeAt(root, path)
      else setAt(root, path, artifacts)
      break
    }
  }
  return `${JSON.stringify(root, null, 2)}\n`
}

/** Writes the checkbox set in canonical mode order. An empty selection is
 * written as an explicit `[]` so the save gate explains it as "no allowed
 * mode" rather than a missing field. */
export function writeManifestSupportedModes(
  text: string,
  modes: AudioMode[]
): string | null {
  const root = parseDraftObject(text)
  if (!root) return null
  const selected = MANIFEST_MODES.filter(mode => modes.includes(mode))
  branch(root, ['audio']).supportedModes = selected
  return `${JSON.stringify(root, null, 2)}\n`
}
