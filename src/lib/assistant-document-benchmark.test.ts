/// <reference types="node" />
import { createHash } from 'node:crypto'
import { readFileSync, writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantDependencies,
  type AssistantRequest,
} from './assistant-flow'
import { buildHelpCorpus, type RawHelpDocument } from './help-corpus'
import { buildHelpIndex, searchHelp } from './help-search'
import type { AssistantWireMessage } from './assistant-types'

const config = {
  baseUrl: 'https://controlled.fixture/v1',
  model: 'fixture-model',
}
const files = import.meta.glob<string>('../../docs/en/**/*.md', {
  query: '?raw',
  import: 'default',
  eager: true,
})
const corpus: RawHelpDocument[] = Object.entries(files).map(
  ([path, markdown]) => ({
    id: path
      .replace('../../docs/en/', '')
      .replace(/\.md$/, '')
      .replaceAll('/', '-')
      .toLowerCase(),
    path: path.replace('../../docs/en/', ''),
    markdown,
    version: `fixture:sha256:${createHash('sha256').update(markdown).digest('hex')}`,
  })
)
const parsed = buildHelpCorpus(corpus)
const index = buildHelpIndex(parsed)
const cases = [
  {
    id: 'outputChannels',
    input: 'What does outputChannels declare?',
    query: 'outputChannels',
  },
  {
    id: 'audio-modes',
    input: 'Compare internal, external and none audio modes.',
    query: 'internal external none',
    docId: 'reference-audio-modes',
  },
  {
    id: 'missing',
    input: 'Where is the undocumented PNDS quantum transport?',
    query: 'pnds_quantum_transport_235_missing',
    missing: true,
  },
  {
    id: 'follow-up',
    input: 'What if outputChannels is absent? Continue the earlier question.',
    query: 'outputChannels',
    overlap: true,
  },
]
const fixturePath = resolve(
  'docs/acceptance/evidence/235-document-flow-packets.json'
)
type Runner = typeof runAssistantRequest

async function capture(run: Runner, sample: (typeof cases)[number]) {
  const hits = searchHelp(index, sample.query)
  const candidates = parsed
    .filter(doc => !sample.docId || doc.id === sample.docId)
    .flatMap(doc =>
      doc.sections
        .filter(
          section =>
            sample.docId ||
            hits
              .slice(0, 5)
              .some(hit => hit.docId === doc.id && hit.sectionId === section.id)
        )
        .map(section => ({ doc, section }))
    )
  const target = candidates.sort(
    (a, b) => b.section.markdown.length - a.section.markdown.length
  )[0]
  const packets: AssistantWireMessage[][] = []
  const deps: AssistantDependencies = {
    corpus: async () => corpus,
    begin: async (_owner, requestId) => ({ requestId, ...config, config }),
    cancel: vi.fn().mockResolvedValue(undefined),
    turn: async (_requestId, messages) => {
      packets.push(structuredClone(messages))
      const ordinal = packets.length
      if (ordinal === 1)
        return {
          text: null,
          toolCalls: [
            {
              id: 'search',
              name: 'search_help',
              arguments: JSON.stringify({ query: sample.query }),
            },
          ],
        }
      if (
        !sample.missing &&
        target &&
        (ordinal === 2 || (sample.overlap && ordinal === 3))
      )
        return {
          text: null,
          toolCalls: [
            {
              id: `read-${ordinal}`,
              name: 'read_help_section',
              arguments: JSON.stringify({
                docId: target.doc.id,
                sectionId: target.section.id,
                offset: ordinal === 2 ? 0 : 600,
              }),
            },
          ],
        }
      return {
        text: 'Controlled fixture response; not a model-quality assessment.',
        toolCalls: [],
      }
    },
  }
  const request: AssistantRequest = {
    identity: 'controlled-owner',
    input: sample.input,
    history: sample.overlap
      ? [
          {
            id: 'prior-user',
            role: 'user',
            text: 'Explain outputChannels.',
            scope: 'platform',
            status: 'completed',
            sources: [],
            contextServiceKey:
              '["https://controlled.fixture/v1","fixture-model"]',
          },
          {
            id: 'prior-assistant',
            role: 'assistant',
            text: 'We discussed the output-channel declaration.',
            scope: 'platform',
            status: 'completed',
            sources: [],
            contextServiceKey:
              '["https://controlled.fixture/v1","fixture-model"]',
          },
        ]
      : [],
    locale: 'en',
    signal: new AbortController().signal,
    isCurrent: () => true,
    expectedConfig: config,
  }
  let failure: string | null = null
  let sources: unknown[] = []
  let documentMetrics: unknown = null
  try {
    const result = await run(
      {
        ...request,
        onUsage: usage => {
          documentMetrics = usage.documentMetrics ?? null
        },
      },
      deps
    )
    sources = result.sources
  } catch (error) {
    failure = error instanceof Error ? error.message : 'unknown'
  }
  return {
    packets,
    sources,
    documentMetrics,
    failure,
    requestMessageBytes: packets.map(packet =>
      Buffer.byteLength(JSON.stringify(packet))
    ),
    toolResults:
      packets
        .at(-1)
        ?.filter(message => message.role === 'tool')
        .map(message => JSON.parse(message.content ?? '{}')) ?? [],
  }
}

it('replays four fixed document questions against the recorded before-flow under the same native budget (#235)', async () => {
  const recorded = JSON.parse(readFileSync(fixturePath, 'utf8'))
  const samples = []
  for (const sample of cases) {
    const before = recorded.cases.find(
      (entry: { id: string }) => entry.id === sample.id
    ).before
    for (const result of before.toolResults) {
      if (Array.isArray(result.hits))
        for (const hit of result.hits)
          expect(Object.keys(hit).sort()).toEqual([
            'docId',
            'docTitle',
            'sectionId',
            'sectionTitle',
            'snippet',
          ])
    }
    const after = await capture(runAssistantRequest, sample)
    expect(after.failure, sample.id).toBeNull()
    expect(after.packets.length).toBe(before.packets.length)
    if (sample.missing) expect(after.sources).toEqual([])
    else expect(after.sources.length).toBeGreaterThan(0)
    if (sample.overlap) {
      const reads = after.toolResults.filter(result =>
        Array.isArray(result.segments)
      )
      expect(reads[1].reusedRanges.length).toBeGreaterThan(0)
      expect(after.requestMessageBytes.at(-1)).toBeLessThan(
        before.requestMessageBytes.at(-1)
      )
    }
    samples.push({ ...sample, before, after })
  }
  if (process.env.PNDS_DOCUMENT_CAPTURE === '1')
    writeFileSync(
      fixturePath,
      JSON.stringify(
        {
          version: 1,
          description:
            'Recorded before document-flow and current flow, replayed by the native public service under identical model/config. Synthetic replies only; no paid quality claims.',
          config: {
            ...config,
            context: {
              capacity: 32000,
              inputTarget: 20000,
              maxOutput: 512,
              reasoningReserve: 0,
              safetyMargin: 256,
              tokenizer: 'cl100kBase',
              source: 'manualUnverified',
            },
          },
          baselineSourceSha256: recorded.baselineSourceSha256,
          baselineSourcesSha256: recorded.baselineSourcesSha256,
          cases: samples,
        },
        null,
        2
      ) + '\n'
    )
})
