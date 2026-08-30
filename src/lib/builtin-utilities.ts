/**
 * v1.3.3 (#84, user report): the built-in utility tools display under
 * concise aliases — their manifest names (the formal identity, kept
 * verbatim in the manifests, the tool repos and the docs) overrun the
 * 320px sidebar card and truncate. Keyed by registry id and resolved
 * from the staged path shape (`…/utilities/<id>`), so an alias follows
 * its tool across staging roots (the dev and release roots differ).
 *
 * The alias is a RESOLUTION-layer fact, not something learned into the
 * store: preflight writes the formal manifest name into
 * manifestProjectNames on every selection (issue #16's generic
 * learning), and that write used to displace an alias seeded at launch
 * — the card flipped back to the truncating long name the moment it was
 * selected. projectDisplayName (and MonitorView's title, same order)
 * therefore checks this map ABOVE the learned names.
 */
export const BUILTIN_UTILITY_DISPLAY_NAMES: Record<string, string> = {
  'multichannel-signal-generator': 'Multichannel Gen',
  'local-network-diagnostics': 'Local Diagnostics',
  'telematic-network-diagnostics': 'Telematic Diagnostics',
}

/** The registry id of a staged utility path (`…/utilities/<id>`). */
export function builtinUtilityId(path: string): string {
  return path.split('/utilities/').pop() ?? path
}
