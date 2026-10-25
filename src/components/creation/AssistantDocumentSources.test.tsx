import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { render, screen } from '@/test/test-utils'
import i18n from '@/i18n/config'
import { openHelpWindow } from '@/lib/help-window'
import { AssistantDocumentSources } from './AssistantDocumentSources'
import type { AssistantSource } from '@/lib/assistant-types'

vi.mock('@/lib/help-window', () => ({ openHelpWindow: vi.fn() }))

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
})

it('offers one section link for multiple pages, with expandable original ranges', async () => {
  const source: AssistantSource = {
    locale: 'en',
    docId: 'reference-manifest',
    sectionId: 'fields',
    title: 'Manifest · Fields',
    version: 'original-version',
    format: 'markdown',
    offset: 0,
    endOffset: 80,
    totalCharacters: 2400,
  }
  const sources = [source, { ...source, offset: 1200, endOffset: 2400 }]
  const before = structuredClone(sources)
  const user = userEvent.setup()
  render(<AssistantDocumentSources sources={sources} />)
  expect(
    screen.getAllByRole('button', { name: 'Manifest · Fields' })
  ).toHaveLength(1)
  await user.click(screen.getByText('2 returned ranges'))
  expect(screen.getAllByText(/original-version/)).toHaveLength(2)
  await user.click(screen.getByRole('button', { name: 'Manifest · Fields' }))
  expect(openHelpWindow).toHaveBeenCalledWith({
    kind: 'doc',
    docId: source.docId,
    anchor: source.sectionId,
    locale: 'en',
  })
  expect(sources).toEqual(before)
})
