/**
 * v1.1.2 T6: custom display-name overrides (spec issue #10). One helper
 * owns the map discipline so the store update and the preference save can
 * never disagree.
 */

/**
 * Rebuilds a display-name map with `path`'s entry upserted. An empty name
 * removes the entry — the card falls back to the path-basename name — and
 * undefined values (the generated binding type is Partial) never survive.
 */
export function upsertDisplayName(
  names: Readonly<Record<string, string | undefined>> | undefined,
  path: string,
  name: string
): Record<string, string> {
  const next: Record<string, string> = {}
  for (const [p, n] of Object.entries(names ?? {})) {
    if (p !== path && n) next[p] = n
  }
  if (name) next[path] = name
  return next
}
