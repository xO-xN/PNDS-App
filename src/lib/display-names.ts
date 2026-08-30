/**
 * v1.1.2 T6: custom display-name overrides (spec issue #10). One helper
 * owns the map discipline so the store update and the preference save can
 * never disagree.
 */

import type { CurrentProject } from '@/store/project-store'
import {
  BUILTIN_UTILITY_DISPLAY_NAMES,
  builtinUtilityId,
} from './builtin-utilities'

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

/**
 * Title-cases a path's last segment (multichannel-tone-test → Multichannel
 * Tone Test) — the fallback name for projects without an override. Shared
 * by the sidebar cards and the settings Projects section so both listings
 * agree on what a project is called.
 */
export function titleCasePath(path: string): string {
  const base = path.split('/').filter(Boolean).pop() ?? path
  return base
    .split('-')
    .map(part => (part ? part.charAt(0).toUpperCase() + part.slice(1) : part))
    .join(' ')
}

/**
 * v1.2.0 (spec issue #15): the one naming rule for project listings — an
 * explicit display-name override wins, then a built-in utility's concise
 * alias (#84: above the manifest layer, so preflight's name learning can
 * never displace it), then the manifest-declared name learned at
 * preflight (issue #16: a bundle install reads as its manifest name, not
 * its `<id>-<version>` directory), then the selected project's manifest
 * name, then the title-cased path basename. Shared by the sidebar cards
 * and the settings Projects section so both always agree.
 */
export function projectDisplayName(
  path: string,
  overrides: Readonly<Record<string, string>>,
  manifestNames: Readonly<Record<string, string>>,
  currentProject: CurrentProject | null
): string {
  if (overrides[path]) return overrides[path]
  const builtinAlias = BUILTIN_UTILITY_DISPLAY_NAMES[builtinUtilityId(path)]
  if (builtinAlias) return builtinAlias
  if (manifestNames[path]) return manifestNames[path]
  if (path === currentProject?.path) return currentProject.manifest.name
  return titleCasePath(path)
}
