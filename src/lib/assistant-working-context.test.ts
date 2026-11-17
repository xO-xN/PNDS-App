import { expect, it } from 'vitest'
import { compactWorkingContext } from './assistant-working-context'
import { projectPageSource } from './assistant-project'
import type { AssistantWireMessage } from './assistant-types'
import type { AssistantProjectPage } from './tauri-bindings'

const page: AssistantProjectPage = {
  path: 'public/monitor.js',
  version: 'saved-v1',
  text: 'const tempo = 80;',
  offset: 0,
  endOffset: 17,
  totalCharacters: 17,
  nextOffset: null,
  startLine: 1,
  endLine: 1,
}

function packet(): AssistantWireMessage[] {
  return [
    { role: 'system', content: 'Policy' },
    { role: 'user', contextKind: 'input', content: 'Keep the original goal.' },
    { role: 'assistant', content: 'old explanation '.repeat(2000) },
  ]
}

const checkpoint = (read: AssistantProjectPage) => ({
  sources: [projectPageSource(read, 'en')],
  completedText: '',
  pendingCandidates: [],
  handoff: null,
})

function receipt(messages: AssistantWireMessage[]) {
  return JSON.parse(
    messages.find(message => message.contextKind === 'summary')?.content ?? '{}'
  ).workingCheckpoint
}

it('retains the actual latest native read without duplicating its visible saved text', () => {
  const messages = packet()
  messages.push(
    {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'read', name: 'read_project_file', arguments: '{}' }],
    },
    {
      role: 'tool',
      toolCallId: 'read',
      content: JSON.stringify({ segments: [page] }),
    }
  )
  expect(compactWorkingContext(messages, checkpoint(page), 8000)).toBe(true)
  expect(messages.at(-1)?.toolCallId).toBe('read')
  expect(receipt(messages).recentSavedText).toEqual([])
  expect(receipt(messages).savedReadCoverage).toContainEqual(
    expect.objectContaining({
      path: page.path,
      version: page.version,
      offset: 0,
      endOffset: page.endOffset,
    })
  )
})

it.each(['saved', 'draft', 'proposal'] as const)(
  'keeps the explicit %s selection separately from recent saved text',
  source => {
    const messages = packet()
    const attachment = { ...page, source }
    const text = JSON.stringify({ attachment })
    messages.push({ role: 'user', contextKind: 'attachment', content: text })
    expect(compactWorkingContext(messages, checkpoint(attachment), 8000)).toBe(
      true
    )
    expect(messages).toContainEqual({
      role: 'user',
      contextKind: 'attachment',
      content: text,
    })
    expect(receipt(messages).recentSavedText).toEqual([])
    expect(receipt(messages).savedReadCoverage).toContainEqual(
      expect.objectContaining({ path: page.path, source })
    )
  }
)

it('keeps non-JSON tools in their complete exchange without inventing a visible saved range', () => {
  const messages = packet()
  messages.push(
    {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'read', name: 'read_project_file', arguments: '{}' }],
    },
    { role: 'tool', toolCallId: 'read', content: 'File unavailable.' }
  )
  expect(compactWorkingContext(messages, checkpoint(page), 8000)).toBe(true)
  expect(messages.at(-1)?.content).toBe('File unavailable.')
  expect(receipt(messages).recentSavedText).toEqual([
    { path: page.path, version: page.version, offset: 0, text: page.text },
  ])
})

it('does not retain a reuse-only exchange after its referenced tool group was removed', () => {
  const messages = packet()
  messages.push(
    {
      role: 'assistant',
      content: null,
      toolCalls: [{ id: 'reuse', name: 'read_project_file', arguments: '{}' }],
    },
    {
      role: 'tool',
      toolCallId: 'reuse',
      content: JSON.stringify({
        segments: [
          {
            path: page.path,
            version: page.version,
            offset: 0,
            endOffset: page.endOffset,
            reusedFrom: 'removed-read',
          },
        ],
      }),
    }
  )
  expect(compactWorkingContext(messages, checkpoint(page), 8000)).toBe(true)
  expect(messages.some(message => message.role === 'tool')).toBe(false)
  expect(JSON.stringify(messages)).not.toContain('removed-read')
  expect(receipt(messages).recentSavedText).toEqual([
    { path: page.path, version: page.version, offset: 0, text: page.text },
  ])
})
