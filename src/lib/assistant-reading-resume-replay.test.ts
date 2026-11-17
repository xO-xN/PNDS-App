import { expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantContinuation,
  type AssistantDependencies,
} from './assistant-flow'
import type { AssistantWireMessage } from './assistant-types'
import type { AssistantRoundUsage } from './tauri-bindings'
import { HELP_BOOKS } from './help-corpus'

it('resumes the last complete read boundary without publishing a later failed group into its evidence or references', async () => {
  const texts: Record<string, string> = {
    'baseline.js': 'const original = true;',
    'later.js': 'const unreadAtCheckpoint = true;',
  }
  const packets: AssistantWireMessage[][] = []
  const usages: AssistantRoundUsage[] = []
  let continuation: AssistantContinuation | null = null
  const read = (id: string, path: string) => ({
    id,
    name: 'read_project_text',
    arguments: JSON.stringify({ path, version: 'saved-v1' }),
  })
  const dependencies: AssistantDependencies = {
    begin: async (_owner, requestId) => ({
      requestId,
      model: 'controlled-provider',
      baseUrl: 'https://fixture.example',
    }),
    cancel: vi.fn(async () => undefined),
    corpus: async () =>
      HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: '# Guide\n\nInstalled documentation.',
        }))
      ),
    readProject: vi.fn(async (_owner, request) => {
      const text = texts[request.path] ?? ''
      return {
        path: request.path,
        version: 'saved-v1',
        text,
        offset: 0,
        endOffset: text.length,
        totalCharacters: text.length,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      }
    }),
    turn: async (_id, messages) => {
      packets.push(structuredClone(messages))
      switch (packets.length) {
        case 1:
          return {
            text: null,
            toolCalls: [read('baseline-read', 'baseline.js')],
          }
        case 2:
          return {
            text: null,
            toolCalls: [
              read('failed-read', 'later.js'),
              read('failed-read', 'later.js'),
            ],
          }
        case 3:
          return {
            text: null,
            toolCalls: [
              read('baseline-again', 'baseline.js'),
              read('later-again', 'later.js'),
            ],
          }
        default:
          return { text: 'Both saved files were read.', toolCalls: [] }
      }
    },
  }
  const request = {
    identity: 'read-checkpoint-owner',
    input: 'Read both saved files.',
    history: [],
    locale: 'en' as const,
    signal: new AbortController().signal,
    isCurrent: () => true,
    projectReading: true,
    project: {
      fingerprint: 'saved-project',
      files: Object.entries(texts).map(([path, text]) => ({
        path,
        version: 'saved-v1',
        bytes: text.length,
        reason: null,
      })),
    },
    onContinuation: (value: AssistantContinuation | null) => {
      // As in the production store, keep the last complete non-null boundary.
      if (value) continuation = value
    },
    onUsage: (usage: AssistantRoundUsage) => usages.push(usage),
  }

  await expect(
    runAssistantRequest(request, dependencies)
  ).rejects.toMatchObject({
    code: 'invalidTool',
  })
  const checkpoint = continuation as AssistantContinuation | null
  expect(checkpoint).not.toBeNull()
  expect(checkpoint?.sources.map(source => source.project?.path)).toEqual([
    'baseline.js',
  ])
  expect(
    checkpoint?.readEvidence?.view().savedText('baseline.js', 'saved-v1')
  ).toMatchObject({ status: 'complete', text: texts['baseline.js'] })
  expect(
    checkpoint?.readEvidence?.view().savedText('later.js', 'saved-v1')
  ).toEqual({ status: 'unavailable' })
  expect(
    checkpoint?.readEvidence?.view().references.hasToolResult('failed-read')
  ).toBe(false)
  expect(
    checkpoint?.messages.some(message => message.toolCallId === 'failed-read')
  ).toBe(false)
  expect(checkpoint?.toolCalls).toBe(1)
  expect(checkpoint?.returnedCharacters).toBe(texts['baseline.js']?.length)

  const result = await runAssistantRequest(
    { ...request, continuation: checkpoint ?? undefined },
    dependencies
  )
  expect(result.text).toBe('Both saved files were read.')
  expect(packets[2]?.[0]?.content).toContain('"remainingCalls":255')
  const baseline = JSON.parse(
    packets[3]?.find(message => message.toolCallId === 'baseline-again')
      ?.content ?? '{}'
  )
  const later = JSON.parse(
    packets[3]?.find(message => message.toolCallId === 'later-again')
      ?.content ?? '{}'
  )
  expect(baseline.segments).toEqual([
    expect.objectContaining({ reusedFrom: 'baseline-read' }),
  ])
  expect(later.segments).toEqual([
    expect.objectContaining({ text: texts['later.js'] }),
  ])
  expect(JSON.stringify(packets[3])).not.toContain('failed-read')
  expect(packets[3]?.[0]?.content).toContain('"remainingCalls":253')
  expect(usages.at(-1)?.documentMetrics).toMatchObject({
    returnedCharacters:
      (texts['baseline.js']?.length ?? 0) + (texts['later.js']?.length ?? 0),
    reusedCharacters: texts['baseline.js']?.length,
  })
})
