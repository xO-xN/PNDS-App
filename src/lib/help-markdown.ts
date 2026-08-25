import GithubSlugger from 'github-slugger'

/**
 * v1.3.0 (#53): the help corpus's markdown structure pass — one module,
 * two consumers. The search index is built from the sections it splits,
 * and the section anchors it derives must be the ids the help window's
 * rendered headings carry (HelpMarkdown slugs through rehype-slug, the
 * same github-slugger algorithm). Both sides feed EVERY heading through a
 * per-document slugger in document order, so duplicate headings get the
 * same "-1" suffix on both sides.
 *
 * Sections split at h1/h2 only (h1 = the document title section): h3+
 * headings stay inside the enclosing section's body, keeping search hits
 * at the page's real navigation granularity. ATX headings only — the
 * corpus is authored exclusively with `#`.
 */

/** A heading-delimited slice of one help document. */
export interface HelpSection {
  /**
   * The anchor id the rendered heading carries (github-slugger output),
   * so a search hit can scroll the help window straight to its section.
   */
  id: string
  /** Heading text with inline markdown stripped. */
  title: string
  /** 1 for the document title section, 2 for content sections. */
  level: 1 | 2
  /** The section body's source markdown, without the heading line. */
  markdown: string
  /** The body as plain text (syntax stripped) — what search matches. */
  text: string
}

const ATX_HEADING = /^(#{1,6}) +(.*?)\s*$/
const FENCE_OPEN = /^( {0,3})(`{3,}|~{3,})(.*)$/

interface SectionBuffer {
  id: string
  title: string
  level: 1 | 2
  bodyLines: string[]
}

function newSection(id: string, title: string, level: 1 | 2): SectionBuffer {
  return { id, title, level, bodyLines: [] }
}

/**
 * Strips the inline markdown noise a snippet must not show: emphasis
 * markers, code backticks, and link/image syntax (keeping the text).
 * Table pipes and list markers stay — they read fine in a snippet.
 * Underscores stay too: in this corpus they are identifier characters
 * (`PERFORMER_PORT` must stay searchable verbatim), not emphasis.
 */
function inlinePlain(fragment: string): string {
  return fragment
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/[*~`]+/g, '')
}

/**
 * Turns section body lines into the plain text search matches against.
 * Fence marker lines and their info strings drop out; the code content
 * stays searchable (searching "performerPort" must hit the manifest
 * examples inside code blocks).
 */
function plainText(bodyLines: readonly string[]): string {
  const textLines: string[] = []
  let inFence = false
  for (const line of bodyLines) {
    if (FENCE_OPEN.test(line)) {
      inFence = !inFence
      continue
    }
    textLines.push(inlinePlain(line))
  }
  return textLines
    .join('\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
}

/**
 * Splits one document's markdown into title + h2 sections. Content before
 * the first heading becomes a synthetic untitled section, dropped when
 * empty — every corpus document opens with its `#` title.
 */
export function splitSections(markdown: string): HelpSection[] {
  const slugger = new GithubSlugger()
  const sections: SectionBuffer[] = []
  let current = newSection('', '', 1)
  let fence: { marker: string; length: number } | null = null

  const closeCurrent = () => {
    sections.push(current)
  }

  for (const line of markdown.split(/\r?\n/)) {
    const fenceMatch = FENCE_OPEN.exec(line)
    const fenceChars = fenceMatch?.[2] ?? ''
    if (fence) {
      current.bodyLines.push(line)
      const closing =
        fenceMatch !== null &&
        fenceChars[0] === fence.marker &&
        fenceChars.length >= fence.length &&
        (fenceMatch[3] ?? '').trim() === ''
      if (closing) fence = null
      continue
    }
    if (fenceMatch) {
      fence = {
        marker: fenceChars[0] ?? '`',
        length: fenceChars.length,
      }
      current.bodyLines.push(line)
      continue
    }

    const heading = ATX_HEADING.exec(line)
    if (heading) {
      const hashes = (heading[1] ?? '').length
      const title = inlinePlain(heading[2] ?? '').trim()
      const id = slugger.slug(title)
      if (hashes <= 2) {
        closeCurrent()
        current = newSection(id, title, hashes === 1 ? 1 : 2)
      } else {
        // Not a section of its own, but its slug still advances the
        // slugger's duplicate counter — the renderer slugs it too.
        current.bodyLines.push(line)
      }
      continue
    }

    current.bodyLines.push(line)
  }
  closeCurrent()

  return sections
    .map(section => ({
      id: section.id,
      title: section.title,
      level: section.level,
      markdown: section.bodyLines.join('\n').trim(),
      text: plainText(section.bodyLines),
    }))
    .filter(section => section.title !== '' || section.markdown !== '')
}
