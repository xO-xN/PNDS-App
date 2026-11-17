import { expect, it } from 'vitest'
import type { AssistantContinuation } from './assistant-flow'
import {
  deserializeAssistantContinuation,
  serializeAssistantContinuation,
} from './assistant-resume'
import { commands } from './tauri-bindings'
import { materialPageSource } from './assistant-materials'
import { projectPageSource } from './assistant-project'
import { AssistantReadEvidence, readPacket } from './assistant-reading-evidence'

function checkpoint(): AssistantContinuation {
  return {
    taskId: 'original-task',
    projectFingerprint: 'saved-files',
    projectSnapshot: { fingerprint: 'saved-files', files: [] },
    key: 'runtime-request-key',
    messages: [
      {
        role: 'user',
        content: 'Keep the original goal.',
        contextKind: 'input',
      },
    ],
    sources: [],
    text: '',
    project: null,
    toolCalls: 0,
    toolCharacters: 0,
    callIds: [],
    calls: [null],
    returnedCharacters: 0,
    reusedCharacters: 0,
    proposals: [],
    handoff: null,
    needsCheck: false,
    lastCheckId: 'checked-saved-files',
    lastCheck: '{"status":"passed"}',
    outputRecoveries: 1,
    contextRecoveries: 2,
  }
}

it('retains every used material identity when older material snapshots are trimmed for restart', () => {
  const data = checkpoint()
  data.sources = Array.from({ length: 9 }, (_, index) => {
    const material = {
      id: index.toString(16).padStart(32, '0'),
      name: `Part-${index}.txt`,
      version: 'a'.repeat(64),
      size: 131072,
      totalCharacters: 65536,
    }
    return materialPageSource(
      {
        material,
        text: '🎼'.repeat(32768),
        offset: 0,
        endOffset: 65536,
        totalCharacters: 65536,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      },
      'en'
    )
  })
  data.materialEvidence = data.sources.flatMap(source =>
    source.material
      ? [
          {
            id: source.material.material.id,
            version: source.material.material.version,
          },
        ]
      : []
  )
  const restored = deserializeAssistantContinuation(
    serializeAssistantContinuation(data)
  )
  expect(restored?.sources.length).toBeLessThan(9)
  expect(restored?.materialEvidence).toEqual(data.materialEvidence)
})

it('preserves version-1 progress and excludes newly added runtime fields by default', () => {
  const runtime = Object.assign(checkpoint(), {
    futureRuntimeField: { privateGrant: 'must-not-persist' },
    readEvidence: new AssistantReadEvidence(),
    recoveryFiles: [{ path: 'a.js', version: 'v2' }],
    restored: true,
  })
  const payload = serializeAssistantContinuation(runtime)
  for (const key of [
    'futureRuntimeField',
    'readEvidence',
    'privateGrant',
    'recoveryFiles',
    'restored',
    'runtime-request-key',
    'proposals',
  ])
    expect(payload).not.toContain(key)
  const restored = deserializeAssistantContinuation(payload)
  expect(restored).toMatchObject({
    taskId: 'original-task',
    needsCheck: false,
    lastCheckId: 'checked-saved-files',
    calls: [null],
    outputRecoveries: 1,
    contextRecoveries: 2,
    key: '',
    restored: true,
    project: null,
    proposals: [],
    messages: [{ content: 'Keep the original goal.' }],
  })
  expect(restored?.documents).toBeUndefined()
  expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
})

it('accepts old version-1 facts while ignoring historical runtime extras', () => {
  const legacy = JSON.parse(serializeAssistantContinuation(checkpoint()))
  legacy.oldRuntimeReader = { authorized: true }
  const restored = deserializeAssistantContinuation(JSON.stringify(legacy))
  expect(restored).not.toBeNull()
  expect(restored).not.toHaveProperty('oldRuntimeReader')
  legacy.version = 2
  expect(deserializeAssistantContinuation(JSON.stringify(legacy))).toBeNull()
})

it('preserves bounded public discussion repair facts without a live offer or execution grant', () => {
  const data = {
    ...checkpoint(),
    discussionRepairAttempted: true,
    discussionFallbackText: 'The complete public plan remains available.',
    handoff: {
      reason: 'Plan ready',
      intent: 'Sustain while held',
      knownProblems: '',
      files: ['score.js'],
      acceptance: 'Release once on lift.',
      plan: 'Hold sustains; lift begins the full release tail.',
    },
  }
  const payload = serializeAssistantContinuation(data)
  const restored = deserializeAssistantContinuation(payload)
  expect(restored).toMatchObject({
    discussionRepairAttempted: true,
    discussionFallbackText: data.discussionFallbackText,
    handoff: data.handoff,
    restored: true,
    key: '',
    project: null,
  })
  for (const [field, value] of [
    ['discussionRepairAttempted', 'true'],
    ['discussionFallbackText', 'x'.repeat(32769)],
    ['handoff', { ...data.handoff, plan: 'x'.repeat(32769) }],
  ] as const) {
    const invalid = JSON.parse(payload)
    invalid[field] = value
    expect(deserializeAssistantContinuation(JSON.stringify(invalid))).toBeNull()
  }
})

it('preserves handoff clarification and selected-plan facts across restart without granting work', () => {
  const data = checkpoint()
  data.purpose = 'handoffDraft'
  data.handoffDraftClarificationAfter = 2
  data.handoffDraftSources = [
    {
      id: 'selected',
      kind: 'creator',
      text: 'Implement a 3.5-octave range in server.js; verify the full range.',
      selectedPlan: {
        text: 'Implement a 3.5-octave range in server.js; verify the full range.',
      },
    },
    {
      id: 'answer',
      kind: 'answer',
      text: 'Which range? Creator answer: 3.5 octaves.',
      decision: '3.5 octaves.',
    },
  ]
  const payload = serializeAssistantContinuation(data)
  const restored = deserializeAssistantContinuation(payload)
  expect(restored?.handoffDraftClarificationAfter).toBe(2)
  expect(restored?.handoffDraftSources).toEqual(data.handoffDraftSources)
  expect(restored?.restored).toBe(true)
  expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
  for (const invalid of [-1, 1.5, 65, '2']) {
    expect(
      deserializeAssistantContinuation(
        JSON.stringify({
          ...JSON.parse(payload),
          handoffDraftClarificationAfter: invalid,
        })
      )
    ).toBeNull()
  }
  for (const source of [
    { id: 'bad', kind: 'creator', text: 'Plan', selectedPlan: null },
    {
      id: 'bad',
      kind: 'creator',
      text: 'Plan',
      selectedPlan: {
        text: 'Plan',
        files: ['../escape'],
        acceptance: 'Verify',
      },
    },
    {
      id: 'bad',
      kind: 'creator',
      text: 'Plan',
      selectedPlan: { text: 'Plan', acceptance: 'Verify' },
    },
    { id: 'bad', kind: 'answer', text: 'Answer', decision: 3.5 },
  ]) {
    expect(
      deserializeAssistantContinuation(
        JSON.stringify({
          ...JSON.parse(payload),
          handoffDraftSources: [source],
        })
      )
    ).toBeNull()
  }
})

it('keeps unknown excluded sizes distinct from measured empty files across restart', () => {
  const data = checkpoint()
  data.projectSnapshot = {
    fingerprint: 'saved-files',
    files: [
      { path: 'voice.scsyndef', bytes: null, version: null, reason: 'binary' },
      { path: 'empty.js', bytes: 0, version: 'empty', reason: null },
    ],
  }
  const restored = deserializeAssistantContinuation(
    serializeAssistantContinuation(data)
  )
  expect(restored?.projectSnapshot?.files).toEqual(data.projectSnapshot?.files)
  const legacy = JSON.parse(serializeAssistantContinuation(data))
  legacy.projectSnapshot.files[0].bytes = 0
  expect(
    deserializeAssistantContinuation(JSON.stringify(legacy))
  ).not.toBeNull()
  legacy.projectSnapshot.files[1].bytes = null
  expect(deserializeAssistantContinuation(JSON.stringify(legacy))).toBeNull()
})

it('keeps complete reasoning and empty reasoning across checkpoint recovery without publishing it as text', () => {
  const data = checkpoint()
  data.messages.push(
    Object.assign(
      {
        role: 'assistant' as const,
        content: null,
        toolCalls: [{ id: 'one', name: 'search_help', arguments: '{}' }],
      },
      { reasoningContent: 'private protocol reasoning' }
    ),
    { role: 'tool', content: 'found', toolCallId: 'one' },
    Object.assign(
      {
        role: 'assistant' as const,
        content: null,
        toolCalls: [{ id: 'two', name: 'search_help', arguments: '{}' }],
      },
      { reasoningContent: '' }
    ),
    { role: 'tool', content: 'found', toolCallId: 'two' }
  )
  const payload = serializeAssistantContinuation(data)
  const restored = deserializeAssistantContinuation(payload)
  expect(restored?.messages).toEqual(data.messages)
  expect(restored?.text).toBe('')
  expect(restored?.activity).toBeUndefined()
  const invalid = JSON.parse(payload)
  invalid.messages[1].reasoningContent = 42
  expect(deserializeAssistantContinuation(JSON.stringify(invalid))).toBeNull()
  invalid.messages[1].reasoningContent = 'x'.repeat(1024 * 1024 + 1)
  expect(deserializeAssistantContinuation(JSON.stringify(invalid))).toBeNull()
})

it.each([
  { toolCalls: -1 },
  { toolCharacters: '100' },
  { needsCheck: 'false' },
  { lastCheckId: 123 },
  { contextRecoveries: -1 },
  {
    projectSnapshot: {
      fingerprint: 'saved',
      files: [{ path: 'a.js', bytes: '100' }],
    },
  },
  {
    sources: [
      {
        docId: 'a',
        sectionId: 'b',
        title: 'a',
        locale: 'en',
        project: {
          path: 'a.js',
          version: 'v1',
          text: 'x',
          offset: 10,
          endOffset: 1,
          totalCharacters: 10,
        },
      },
    ],
  },
])('rejects malformed persisted facts: %j', invalid => {
  const data = {
    ...JSON.parse(serializeAssistantContinuation(checkpoint())),
    ...invalid,
  }
  expect(deserializeAssistantContinuation(JSON.stringify(data))).toBeNull()
})

it('rejects incomplete, orphaned and reused tool replies instead of fabricating completed work', () => {
  const data = JSON.parse(serializeAssistantContinuation(checkpoint()))
  const toolCall = {
    role: 'assistant',
    content: null,
    toolCalls: [{ id: 'write', name: 'write_project_file', arguments: '{}' }],
  }
  const reply = { role: 'tool', content: 'saved', toolCallId: 'write' }
  for (const messages of [
    [toolCall],
    [reply],
    [toolCall, reply, reply],
    [toolCall, reply, toolCall, reply],
  ]) {
    expect(
      deserializeAssistantContinuation(JSON.stringify({ ...data, messages }))
    ).toBeNull()
  }
  expect(
    deserializeAssistantContinuation(
      JSON.stringify({ ...data, messages: [toolCall, reply] })
    )
  ).not.toBeNull()
})

it('bounds retained source snapshots without inventing omitted read coverage', () => {
  const data = checkpoint()
  data.sources = ['first', 'second', 'third'].map(path => ({
    docId: path,
    sectionId: 'L1',
    title: path,
    locale: 'en',
    project: {
      path,
      version: 'v1',
      source: 'saved',
      text: 'x'.repeat(600000),
      offset: 0,
      endOffset: 600000,
      totalCharacters: 900000,
      nextOffset: 600000,
      startLine: 1,
      endLine: 1,
    },
  }))
  const restored = deserializeAssistantContinuation(
    serializeAssistantContinuation(data)
  )
  expect(restored?.sources).toHaveLength(1)
  expect(restored?.sources[0]?.project).toMatchObject({
    path: 'third',
    endOffset: 600000,
    totalCharacters: 900000,
  })
  expect(serializeAssistantContinuation(data)).not.toContain('first')
})

it('keeps the immutable original question scope when only a display chat key changes', () => {
  const data = checkpoint()
  data.questionScope = {
    chatId: 'original-topic-before-promotion',
    messageId: 'original-reply',
  }
  data.waitingQuestionId = 'current-question'
  const payload = serializeAssistantContinuation(data)
  expect(deserializeAssistantContinuation(payload)).toMatchObject({
    questionScope: data.questionScope,
    waitingQuestionId: 'current-question',
  })
  const invalid = JSON.parse(payload)
  invalid.questionScope.messageId = 123
  expect(deserializeAssistantContinuation(JSON.stringify(invalid))).toBeNull()
  expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
})

it.each([undefined, null, 'saved'] as const)(
  'restores V1 source %s in its original native or attachment domain',
  source => {
    const data = checkpoint()
    const page = {
      path: 'server.js',
      version: 'v1',
      text: 'server',
      source,
      offset: 0,
      endOffset: 6,
      totalCharacters: 6,
      nextOffset: null,
      startLine: 1,
      endLine: 1,
    }
    data.sources = [projectPageSource(page, 'en')]
    const restored = deserializeAssistantContinuation(
      serializeAssistantContinuation(data)
    )
    expect(restored).not.toBeNull()
    const reads = new AssistantReadEvidence(restored?.sources)
    expect(reads.view().savedText('server.js', 'v1').status).toBe(
      source == null ? 'complete' : 'unavailable'
    )
    expect(restored?.sources[0]?.project?.source).toBe(source)
    expect(reads.view().references.hasToolResult('old-read')).toBe(false)
  }
)

it('does not recover trimmed V1 body proof from text still present in an old tool message', () => {
  const data = checkpoint()
  const body = 'x'.repeat(1100000)
  const page = {
    path: 'server.js',
    version: 'v1',
    text: body,
    offset: 0,
    endOffset: body.length,
    totalCharacters: body.length,
    nextOffset: null,
    startLine: 1,
    endLine: 1,
  }
  data.sources = [projectPageSource(page, 'en')]
  data.messages.push(
    {
      role: 'assistant',
      content: null,
      toolCalls: [
        {
          id: 'old-read',
          name: 'read_project_text',
          arguments: '{"path":"server.js"}',
        },
      ],
    },
    {
      role: 'tool',
      toolCallId: 'old-read',
      content: JSON.stringify({ segments: [page] }),
    }
  )
  const restored = deserializeAssistantContinuation(
    serializeAssistantContinuation(data)
  )
  expect(restored?.sources).toEqual([])
  expect(restored?.messages.at(-1)?.content).toContain(body)
  const reads = new AssistantReadEvidence(restored?.sources)
  reads.replaceContext({
    kind: 'packetReplaced',
    packet: readPacket(restored?.messages ?? []),
  })
  expect(reads.view().savedText('server.js', 'v1').status).toBe('unavailable')
  expect(reads.view().references.hasToolResult('old-read')).toBe(false)
})
