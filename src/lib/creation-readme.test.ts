import { describe, expect, it } from 'vitest'
import {
  editReadmeCover,
  inspectEditableReadme,
  type CoverField,
} from './creation-readme'
import { parseReadmeCoverPage } from './readme-cover-page'

const source =
  '# Work\r\n\r\ncomposer: @Author\r\ncustom: keep exactly\r\n\r\n## Introduction\r\n\r\nFull body.\r\n\r\n---\r\n\r\n## Later\r\nNever rewrite this.\r\n'

describe('audience metadata source edits', () => {
  it.each(['About the piece', '作品简介：'])(
    'lets creators fill an initially empty Blank introduction in %s',
    heading => {
      const text = `# Untitled\n\ntitle: Untitled\ncomposer: \n\n## ${heading}\n\n\n`
      const document = inspectEditableReadme(text)
      if (document.kind !== 'cover') throw new Error('expected editable cover')
      expect(document.fields.sectionMarkdown).toBe('')
      const saved = editReadmeCover(
        text,
        document,
        'sectionMarkdown',
        'A piece for three performers.'
      )
      expect(parseReadmeCoverPage(saved.text)).toMatchObject({
        sectionMarkdown: 'A piece for three performers.',
      })
    }
  )
  it('inserts all missing fields, edits them again and preserves unrelated README bytes and CRLF', () => {
    const original = inspectEditableReadme(source)
    if (original.kind !== 'cover') throw new Error('expected editable cover')
    let current = { text: source, document: original }
    const edits: [CoverField, string][] = [
      ['duration', '6′32″'],
      ['performers', 'A、B、C、D'],
      ['contact', '@mail.com'],
      ['composer', 'New author'],
      ['duration', '7′10″'],
    ]
    for (const [field, value] of edits)
      current = editReadmeCover(current.text, current.document, field, value)
    expect(current.text).toContain('custom: keep exactly\r\n')
    expect(current.text.slice(current.text.indexOf('## Introduction'))).toBe(
      source.slice(source.indexOf('## Introduction'))
    )
    expect(current.text.replace(/\r\n/g, '')).not.toContain('\n')
    expect(parseReadmeCoverPage(current.text)).toMatchObject({
      composer: 'New author',
      duration: '7′10″',
      performers: 'A、B、C、D',
      contact: '@mail.com',
    })
    expect(inspectEditableReadme(current.text)).toMatchObject({
      kind: 'cover',
      fields: {
        duration: '7′10″',
        performers: 'A、B、C、D',
        contact: '@mail.com',
      },
    })
  })
  it.each(['duration', 'performers', 'contact'])(
    'protects duplicate %s fields and refuses line injection',
    field => {
      expect(
        inspectEditableReadme(`${field}: one\r\n${field}: two\r\n${source}`)
      ).toEqual({ kind: 'unsafe', reason: 'duplicate' })
      const document = inspectEditableReadme(source)
      if (document.kind !== 'cover') throw new Error('expected editable cover')
      expect(
        editReadmeCover(
          source,
          document,
          field as CoverField,
          'one\nother: injected'
        ).text
      ).toBe(source)
    }
  )
})
