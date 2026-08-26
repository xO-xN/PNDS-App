import type { HelpDocument } from './help-corpus'

/**
 * v1.3.0 (#56 user report): the help center must never let a corpus link
 * navigate its webview away from help.html — that booted the whole main
 * app inside the help window and wrecked it. Every markdown link is
 * resolved here BEFORE any default handling:
 *
 * - relative `.md` targets resolve against the LINKING document's own
 *   language-tree-relative path and become in-window navigation. `..` is
 *   CLAMPED at the language-tree root: parts of the corpus were authored
 *   as if the base were the repository root (`../reference/x.md` from
 *   docs/zh-CN/app-tutorial.md), and clamping reads that intent instead
 *   of escaping;
 * - `#fragment` alone anchors inside the current document;
 * - URLs with a scheme (https, mailto, …) leave via the system browser;
 * - anything that matches no document is null — the click no-ops rather
 *   than navigating anywhere unexpected.
 */

/** What a resolved corpus link asks the window to do. */
export type HelpLinkTarget =
  | { kind: 'doc'; docId: string; anchor: string | null }
  | { kind: 'external'; url: string }

/** The corpus shape link resolution needs — id plus language-tree-relative path. */
export type LinkableDoc = Pick<HelpDocument, 'id' | 'path'>

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

/**
 * Resolves one markdown link href into a navigation target, or null when
 * nothing in the corpus matches (clicks on null do nothing).
 */
export function resolveHelpLink(
  href: string,
  currentDoc: LinkableDoc,
  corpus: readonly LinkableDoc[]
): HelpLinkTarget | null {
  if (href === '') return null

  // Anything with a scheme is not a corpus path: hand it to the system
  // browser — never the webview.
  if (SCHEME.test(href)) {
    return { kind: 'external', url: href }
  }

  const hashAt = href.indexOf('#')
  const rawPath = hashAt === -1 ? href : href.slice(0, hashAt)
  const anchor = hashAt === -1 ? null : href.slice(hashAt + 1)

  if (rawPath === '' || rawPath === '/') {
    // "#anchor" within the current document.
    return { kind: 'doc', docId: currentDoc.id, anchor }
  }

  const baseDir = currentDoc.path.includes('/')
    ? currentDoc.path.slice(0, currentDoc.path.lastIndexOf('/'))
    : ''
  const joined = rawPath.startsWith('/')
    ? rawPath.slice(1)
    : `${baseDir}/${rawPath}`
  const normalized = normalizeDocsPath(joined)

  const target = corpus.find(doc => doc.path === normalized)
  if (target === undefined) return null
  return { kind: 'doc', docId: target.id, anchor }
}

/**
 * Collapses `.` and `..` segments; `..` at the root pops nothing (the
 * language tree is the world — nothing exists above it to link to).
 */
function normalizeDocsPath(path: string): string {
  const segments: string[] = []
  for (const segment of path.split('/')) {
    if (segment === '' || segment === '.') continue
    if (segment === '..') {
      segments.pop()
      continue
    }
    segments.push(segment)
  }
  return segments.join('/')
}
