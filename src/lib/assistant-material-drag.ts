// Tauri grants filesystem scope to native dropped paths. This marker cannot
// identify a file because /dev/null is a device, and has no private path data.
const prefix = '/dev/null/pnds-assistant-reference-'
let active: {
  id: string
  identity: string
  version: string
  marker: string
} | null = null

export function beginAssistantMaterialDrag(
  identity: string,
  id: string,
  version: string
) {
  const token = crypto.randomUUID()
  active = { identity, id, version, marker: `${prefix}${token}` }
  return token
}

export function isAssistantMaterialMarker(path: string) {
  return path.startsWith(prefix)
}

export function takeAssistantMaterialDrag(paths: string[]) {
  if (!active || !paths.includes(active.marker)) return null
  const drag = active
  active = null
  return drag
}

export function cancelAssistantMaterialDrag(token: string) {
  if (active?.marker === `${prefix}${token}`) active = null
}
