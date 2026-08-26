import { describe, it, expect } from 'vitest'
import { HELP_TREES, type HelpTree } from './help-corpus'
import { resolveHelpLink, type LinkableDoc } from './help-links'

/**
 * #67 (ADR-0001): the help corpus ships as two mirror language trees,
 * docs/zh-CN/ and docs/en/. This is the frontend half of the bilingual
 * drift fence — the Rust half lives in src-tauri/src/commands/help.rs.
 * Either tree missing a page fails HERE at test time, never as a
 * silent fallback to the other language at runtime. It also pins the
 * en/ tree's own health ahead of #68 (which starts serving it): every
 * document keeps exactly one `#` heading (the derived title), the
 * anchor-parity style assumptions of help-scale.test.ts hold, and
 * every cross-document link resolves INSIDE the en/ tree — a link that
 * would wander out of the tree no-ops in the help window instead of
 * navigating.
 */

const TREE_FILES = {
  'zh-CN': import.meta.glob('../../docs/zh-CN/**/*.md', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>,
  en: import.meta.glob('../../docs/en/**/*.md', {
    eager: true,
    query: '?raw',
    import: 'default',
  }) as Record<string, string>,
  // The literal keys above are the coupling to HELP_TREES: adding a
  // tree to the contract without a glob here (or vice versa) is a type
  // error, not a silent gap in the fence.
} satisfies Record<HelpTree, Record<string, string>>

/** Tree-relative paths of every markdown file in one language tree. */
function treePaths(tree: HelpTree): string[] {
  return Object.keys(TREE_FILES[tree])
    .map(key => key.slice(`../../docs/${tree}/`.length))
    .sort()
}

interface TreeDocument {
  path: string
  markdown: string
}

function treeDocuments(tree: HelpTree): TreeDocument[] {
  return treePaths(tree).map(path => {
    const markdown = TREE_FILES[tree][`../../docs/${tree}/${path}`]
    if (markdown === undefined) {
      throw new Error(`no glob entry wired for docs/${tree}/${path}`)
    }
    return { path, markdown }
  })
}

/**
 * Corpus lines outside fenced code blocks — the only lines where
 * headings and links count. Deliberately re-implements the fence
 * toggle rather than importing help-markdown's scanner: this file
 * pins the trees against assumptions that module makes, so it must
 * keep failing even if that module's fence handling drifts.
 */
function linesOutsideFences(markdown: string): string[] {
  const lines: string[] = []
  let inFence = false
  for (const line of markdown.split(/\r?\n/)) {
    if (/^( {0,3})(`{3,}|~{3,})/.test(line)) {
      inFence = !inFence
      continue
    }
    if (!inFence) lines.push(line)
  }
  return lines
}

describe('bilingual help trees (#67)', () => {
  it('mirrors the file sets of every registered tree', () => {
    expect(HELP_TREES.length).toBeGreaterThanOrEqual(2)
    const [reference, ...mirrors] = HELP_TREES
    expect(
      treePaths(reference).length,
      `${reference} tree is empty`
    ).toBeGreaterThan(0)
    for (const tree of mirrors) {
      expect(treePaths(tree).length, `${tree} tree is empty`).toBeGreaterThan(0)
      // A page translated on one side only (or a renamed file on one
      // side) breaks HERE — the Rust set-equality test carries the same
      // assertion against the shipped allowlist. Every tree is checked
      // against the first, so a future third tree cannot slip through
      // unchecked.
      expect(treePaths(tree)).toEqual(treePaths(reference))
    }
  })

  it('gives every en/ document exactly one `#` heading', () => {
    for (const document of treeDocuments('en')) {
      const h1 = linesOutsideFences(document.markdown).filter(line =>
        line.startsWith('# ')
      )
      expect(
        h1,
        `${document.path}: titles derive from the document's own # heading — expected exactly one`
      ).toHaveLength(1)
    }
  })

  it('keeps the en/ tree inside the anchor-parity assumptions', () => {
    // Same pin as help-scale.test.ts, which guards the served zh-CN
    // tree: splitSections reads ATX headings at column 0 only.
    for (const document of treeDocuments('en')) {
      let previousWasText = false
      for (const line of linesOutsideFences(document.markdown)) {
        if (/^ {1,6}#{1,6} /.test(line)) {
          throw new Error(
            `${document.path}: indented ATX heading breaks anchor parity: "${line}"`
          )
        }
        if (previousWasText && /^(=+|-+)\s*$/.test(line)) {
          throw new Error(
            `${document.path}: setext heading breaks anchor parity: "${line}"`
          )
        }
        previousWasText = line.trim() !== ''
      }
    }
  })

  it('resolves every en/ cross-document link inside the en/ tree', () => {
    // The corpus as the help window will see it once #68 serves this
    // tree: one linkable entry per en/ file.
    const corpus: LinkableDoc[] = treePaths('en').map(path => ({
      id: path,
      path,
    }))

    for (const document of treeDocuments('en')) {
      const self: LinkableDoc = { id: document.path, path: document.path }
      const hrefs = linesOutsideFences(document.markdown).flatMap(line =>
        [...line.matchAll(/\[[^\]]*\]\(([^)]+)\)/g)].map(
          match => match[1]?.split(/\s+/)[0] ?? ''
        )
      )
      for (const href of hrefs) {
        const target = resolveHelpLink(href, self, corpus)
        if (target === null) {
          throw new Error(
            `${document.path}: link "${href}" resolves to nothing in the en/ tree (it would no-op in the help window)`
          )
        }
      }
    }
  })
})
