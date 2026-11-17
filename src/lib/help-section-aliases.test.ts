import { expect, it } from 'vitest'
import { AssistantDocuments } from './assistant-documents'
import type { HelpDocument } from './help-corpus'
import { resolveHelpLink } from './help-links'
import { splitSections } from './help-markdown'
import { resolveHelpSectionId } from './help-section-aliases'

const markdown = "# PNDS Creator's Guide\n\nCreate a Blank project.\n"
const guide: HelpDocument = {
  id: 'template-guide',
  path: 'template-guide.md',
  book: 'creator-guide',
  title: "PNDS Creator's Guide",
  markdown,
  sections: splitSections(markdown),
  version: 'current-guide',
}

it('resolves published headings without keeping retired prose in the corpus', () => {
  expect(
    resolveHelpLink('#pnds-template-creators-guide', guide, [guide])
  ).toEqual({
    kind: 'doc',
    docId: guide.id,
    anchor: 'pnds-creators-guide',
  })
  expect(
    resolveHelpSectionId(guide.id, encodeURIComponent('pnds-template-创作指南'))
  ).toBe('pnds-创作指南')
  expect(guide.markdown).not.toContain('Template')
})

it('reads canonical evidence and shares coverage when an old section is requested', () => {
  const documents = new AssistantDocuments([guide], 'en')
  const old = documents.execute(
    'read_help_section',
    { docId: guide.id, sectionId: 'pnds-template-creators-guide' },
    'old-link'
  )
  const current = documents.execute(
    'read_help_section',
    { docId: guide.id, sectionId: 'pnds-creators-guide' },
    'current-link'
  )
  expect(JSON.parse(old.content).sectionId).toBe('pnds-creators-guide')
  expect(old.sources[0]?.sectionId).toBe('pnds-creators-guide')
  expect(JSON.parse(old.content).segments[0].markdown).toContain(
    'Create a Blank project.'
  )
  expect(current.returnedCharacters).toBe(0)
  expect(current.reusedCharacters).toBeGreaterThan(0)
})

it('keeps unknown and malformed fragments unmatched', () => {
  for (const fragment of ['unknown-section', '%broken', 'constructor'])
    expect(resolveHelpSectionId(guide.id, fragment)).toBe(fragment)
  expect(resolveHelpSectionId('__proto__', 'constructor')).toBe('constructor')
  expect(() =>
    new AssistantDocuments([guide], 'en').execute(
      'read_help_section',
      { docId: guide.id, sectionId: 'unknown-section' },
      'unknown'
    )
  ).toThrow()
  expect(
    resolveHelpSectionId(guide.id, '%2570nds-template-creators-guide')
  ).toBe('%70nds-template-creators-guide')
  expect(() =>
    new AssistantDocuments([guide], 'en').execute(
      'read_help_section',
      { docId: guide.id, sectionId: '%2570nds-template-creators-guide' },
      'double-encoded'
    )
  ).toThrow()
})
