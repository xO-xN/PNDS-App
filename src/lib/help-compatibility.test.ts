import GithubSlugger from 'github-slugger'
import { describe, expect, it } from 'vitest'
import publicAnchors from '@/test/fixtures/help-public-anchors.json'
import { resolveHelpLink } from './help-links'
import { resolveHelpSectionId } from './help-section-aliases'

const files = import.meta.glob<string>('../../docs/{zh-CN,en}/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
})

function headings(markdown: string) {
  const slugger = new GithubSlugger()
  const anchors = new Set<string>()
  let fence: string | null = null
  for (const line of markdown.split(/\r?\n/)) {
    const marker = /^ {0,3}(`{3,}|~{3,})(.*)$/.exec(line)
    const characters = marker?.[1]
    if (fence) {
      if (
        characters &&
        characters[0] === fence[0] &&
        characters.length >= fence.length &&
        marker?.[2]?.trim() === ''
      )
        fence = null
      continue
    }
    if (marker?.[1]) {
      fence = marker[1]
      continue
    }
    const heading = /^#{1,6} +(.*?)\s*$/.exec(line)?.[1]
    if (heading)
      anchors.add(
        slugger.slug(
          heading
            .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
            .replace(/[*~`]+/g, '')
        )
      )
  }
  return anchors
}

describe('shipped help compatibility', () => {
  for (const locale of ['zh-CN', 'en'] as const) {
    const prefix = `../../docs/${locale}/`
    const corpus = Object.entries(files)
      .filter(([path]) => path.startsWith(prefix))
      .map(([path, markdown]) => ({
        path: path.slice(prefix.length),
        id: path
          .slice(prefix.length)
          .replace(/\.md$/, '')
          .replaceAll('/', '-')
          .toLowerCase(),
        markdown,
        anchors: headings(markdown),
      }))

    it(`preserves previously shipped paths and anchors in ${locale}`, () => {
      for (const [path, anchors] of Object.entries(publicAnchors[locale])) {
        const doc = corpus.find(doc => doc.path === path)
        expect(doc, path).toBeDefined()
        for (const anchor of anchors)
          expect(
            doc?.anchors.has(resolveHelpSectionId(doc.id, anchor)),
            `${locale}/${path}#${anchor}`
          ).toBe(true)
      }
    })

    it(`resolves document links and heading fragments in ${locale}`, () => {
      for (const doc of corpus) {
        // Ignore code examples: their sample links are not help navigation.
        const prose = doc.markdown.replace(
          /^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gm,
          ''
        )
        for (const link of prose.matchAll(/(?<!!)\[[^\]]*\]\(([^)]+)\)/g)) {
          const href = link[1] ?? ''
          const target = resolveHelpLink(href, doc, corpus)
          expect(target, `${locale}/${doc.path}: ${href}`).not.toBeNull()
          if (target?.kind === 'doc' && target.anchor) {
            const destination = corpus.find(doc => doc.id === target.docId)
            expect(
              destination?.anchors.has(decodeURIComponent(target.anchor)),
              `${locale}/${doc.path}: ${href}`
            ).toBe(true)
          }
        }
      }
    })
  }
})
