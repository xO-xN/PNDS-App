/**
 * v1.5.0 (README cover page): the creator-designed README format behind
 * the main area's cover page.
 *
 * A project ships a README like:
 *
 * ```markdown
 * # 失语 III
 *
 * **中文** | [English](README.md)
 *
 * title: 失语 III
 * composer: @肖翔
 * composer_url: https://…
 * github_url: https://github.com/…
 * color_palette: [#000000, #C9D8B6, #F1ECC3, #57837B]
 *
 * ## 作品简介：
 *
 * <the one custom section — the panel's band text>
 *
 * ---
 *
 * ## 关于作品
 * <boilerplate for GitHub readers; the panel stops at the --- >
 * ```
 *
 * The panel renders everything the template owns (the four-dot mark,
 * the PNDS wordmark, the divider, the composer pill, the huge title,
 * the cover band) and takes the creator's data from the metadata lines
 * plus the FIRST `##` section, which ends at a `---` thematic break or
 * the next heading. A README without the metadata block is not this
 * format — `null` — and the panel falls back to rendering it as a
 * plain document, so every legacy project keeps working.
 *
 * Parsing is line-based and fence-aware; every field degrades to a
 * documented default instead of failing the page.
 */

/** The parsed cover page. Every field is render-ready. */
export interface ReadmeCoverPage {
  /** Metadata `title:`, falling back to the H1. */
  title: string
  /** Metadata `composer:` verbatim (the pill text); null hides the pill. */
  composer: string | null
  /** Metadata `composer_url:` — when an http(s) URL, the pill becomes a
   * button opening it in the system browser; null keeps it inert. */
  composerUrl: string | null
  /** Metadata `github_url:` — when an http(s) URL, a `github` button
   * joins the header; null hides it. */
  githubUrl: string | null
  /** Four sanitized hex colors for the diamond mark, in panel order
   * (left, top, right, bottom). */
  palette: readonly [string, string, string, string]
  /** The first `##` heading's text, verbatim (作品简介： / 演奏说明： …). */
  sectionLabel: string
  /** The first section's body markdown (headings/strips excluded). */
  sectionMarkdown: string
}

/** The fallback diamond when a project ships no usable color_palette —
 * the app logo's own brand colors (PndsLogo's PALETTE head), so a
 * palette-less project still reads as PNDS. */
export const DEFAULT_COVER_PALETTE: readonly [string, string, string, string] =
  ['#34c759', '#ffcc00', '#ff3b30', '#af52de']

type MetadataKey =
  | 'title'
  | 'composer'
  | 'composerUrl'
  | 'githubUrl'
  | 'colorPalette'

const METADATA_KEYS: Record<string, MetadataKey> = {
  title: 'title',
  composer: 'composer',
  composer_url: 'composerUrl',
  github_url: 'githubUrl',
  color_palette: 'colorPalette',
}

/** One metadata line: `key: value` with a known key (case-insensitive). */
const METADATA_LINE = /^([A-Za-z_]+):\s*(.*)$/

const H1 = /^#(?!#)\s+(.*?)\s*$/
const H2 = /^##(?!#)\s+(.*?)\s*$/
const THEMATIC_BREAK = /^\s*-{3,}\s*$/
const FENCE = /^\s{0,3}(?:```|~~~)/

/** Hex colors (3/4/6/8 digits) inside a color_palette value. */
const HEX = /#(?:[0-9a-fA-F]{3,4}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})\b/g

/** A link field: only http(s) URLs are honored — anything else (ftp,
 * javascript:, garbage) is treated as absent rather than handed to the
 * system browser. */
function sanitizeUrl(raw: string | undefined): string | null {
  const value = (raw ?? '').trim()
  return /^https?:\/\//i.test(value) ? value : null
}

function sanitizePalette(
  raw: string | undefined
): readonly [string, string, string, string] {
  if (!raw) return DEFAULT_COVER_PALETTE
  const found = [...raw.matchAll(HEX)]
    .map(match => match[0]?.toLowerCase() ?? '')
    .filter(hex => hex !== '')
  // Fewer than four valid hexes is not a palette the creator meant —
  // the brand default beats a half-authored diamond.
  if (found.length < 4) return DEFAULT_COVER_PALETTE
  return found.slice(0, 4) as [string, string, string, string]
}

/**
 * Parses a README into the cover page. `null` when the README is not
 * the cover format (no metadata block, no first section, or no title
 * either way) — the caller then renders the legacy document view.
 */
export function parseReadmeCoverPage(markdown: string): ReadmeCoverPage | null {
  const lines = markdown.split(/\r?\n/)

  // Pass 1 — the top region (before the first ##): the H1 and the
  // metadata lines. Anything inside a code fence is content, not syntax.
  let inFence = false
  let h1: string | null = null
  let metadataCount = 0
  const metadata: Partial<Record<MetadataKey, string>> = {}
  let firstHeading: number | null = null
  let firstLabel: string | null = null

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index] as string
    if (FENCE.test(line)) {
      inFence = !inFence
      continue
    }
    if (inFence) continue

    const h2 = H2.exec(line)
    if (h2) {
      firstHeading = index
      firstLabel = h2[1] ?? ''
      break
    }
    if (h1 === null) {
      const match = H1.exec(line)
      if (match) h1 = match[1] ?? ''
    }
    const meta = METADATA_LINE.exec(line)
    if (meta) {
      const key = METADATA_KEYS[meta[1]?.toLowerCase() ?? '']
      if (key && metadata[key] === undefined) {
        metadata[key] = meta[2]?.trim() ?? ''
        metadataCount += 1
      }
    }
  }

  const title = (metadata.title ?? '').trim() || (h1 ?? '').trim()
  if (metadataCount === 0 || firstHeading === null || title === '') {
    return null
  }

  // Pass 2 — the first section's body: from after its heading until a
  // `---` thematic break (the panel/GitHub boundary) or the next
  // heading, whichever comes first. Fences ride along as content.
  const bodyLines: string[] = []
  inFence = false
  for (let index = firstHeading + 1; index < lines.length; index += 1) {
    const line = lines[index] as string
    if (FENCE.test(line)) {
      inFence = !inFence
      bodyLines.push(line)
      continue
    }
    if (!inFence && (THEMATIC_BREAK.test(line) || H2.test(line))) break
    bodyLines.push(line)
  }

  return {
    title,
    composer: (metadata.composer ?? '').trim() || null,
    composerUrl: sanitizeUrl(metadata.composerUrl),
    githubUrl: sanitizeUrl(metadata.githubUrl),
    palette: sanitizePalette(metadata.colorPalette),
    sectionLabel: firstLabel ?? '',
    sectionMarkdown: bodyLines.join('\n').trim(),
  }
}
