import type { ReadmeCoverPage } from '@/lib/readme-cover-page'

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

/**
 * v1.5.0 polish: the registry id of a path that REALLY is a staged
 * utility — the path shape alone (`…/utilities/<something>`) only says
 * "staged layout"; only a known registry id says "built-in utility".
 * Null for every author project (a user folder that merely contains
 * the word included), so the README routing can pick the utility info
 * page without false positives.
 */
export function utilityIdFromPath(path: string): string | null {
  const id = builtinUtilityId(path)
  return BUILTIN_UTILITY_DISPLAY_NAMES[id] !== undefined ? id : null
}

/**
 * v1.5.0 polish (follow-up round: the projection screen showed the
 * utilities' non-existent README as raw markdown/name card): the
 * utility info page's PAGE MODEL, shared by both windows — the main
 * area's UtilityIntro and the projection 简介 render the SAME synthetic
 * cover page, so the venue screen matches the app window by
 * construction. The title is the registry alias; the four-dot mark is
 * the theme's ink (a utility is app content — the brand rainbow stays
 * reserved for authored works); the intro line arrives translated from
 * the caller (`utilities.intro.<id>` in the locales).
 */
export function utilityCoverPage(id: string, intro: string): ReadmeCoverPage {
  return {
    title: BUILTIN_UTILITY_DISPLAY_NAMES[id] ?? id,
    composer: null,
    composerUrl: null,
    githubUrl: null,
    websiteUrl: null,
    // The theme's ink as a CSS var — the mark recolors with every
    // theme instead of shipping a fixed palette.
    palette: [
      'var(--pnds-text)',
      'var(--pnds-text)',
      'var(--pnds-text)',
      'var(--pnds-text)',
    ],
    sectionLabel: '',
    sectionMarkdown: intro,
  }
}
