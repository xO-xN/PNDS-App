/**
 * v1.5.0 (#135, contract §14): the zoom-ownership handshake — the
 * page→host direction's first message. An adapted project's monitor
 * page, embedded in the projection window, may declare at load that
 * IT owns the zoom (`postMessage({type:"pnds-projection",
 * zoom:"page"}, "*")` to its host). On receipt the App stops applying
 * its own ⌘= zoom actions to that copy — the keys belong to the page
 * (the venue surface keeps its cursor-anchored, density-following
 * zoom); undeclared projects behave exactly as before.
 *
 * The payload is a capability string, nothing sensitive — "*" as
 * targetOrigin is part of the contract (the page cannot know its
 * host's origin). `zoom` has only the value "page" this version; the
 * value set is reserved for extension, so unknown values are ignored
 * (never an error), like every other malformed shape below.
 */

/** The §14 message type — the page→host family's discriminator. */
export const PROJECTION_HANDSHAKE_TYPE = 'pnds-projection'

/** The §14 declaration: this copy's zoom belongs to the page. */
export interface PageZoomDeclaration {
  type: typeof PROJECTION_HANDSHAKE_TYPE
  zoom: 'page'
}

/**
 * Guard for the declaration: `type` and `zoom` must match exactly
 * (extra fields are ignored, not rejected). Anything else flying by
 * (unknown types, unknown `zoom` values, non-objects, other windows'
 * traffic) must be ignored without throwing — page content is
 * untrusted input.
 */
export function isPageZoomDeclaration(
  data: unknown
): data is PageZoomDeclaration {
  if (typeof data !== 'object' || data === null) return false
  const { type, zoom } = data as Record<string, unknown>
  return type === PROJECTION_HANDSHAKE_TYPE && zoom === 'page'
}
