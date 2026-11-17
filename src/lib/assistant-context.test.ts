import { expect, it } from 'vitest'
import {
  creatorContextRecords,
  selectAssistantContext,
} from './assistant-context'
import { restoreAssistantMessages } from './assistant-history'
import { buildAssistantMessages } from './assistant-flow'
import { compactWorkingContext } from './assistant-working-context'
import { modelProfileKey } from './model-context-settings'
import { projectPageSource } from './assistant-project'
import type { AssistantMessage } from './assistant-types'
import type { AssistantQuestion } from './tauri-bindings'

const config = { model: 'selected', baseUrl: 'https://model.example/v1' }
const project = {
  fingerprint: 'current',
  files: [{ path: 'score.js', version: 'v2', bytes: 10, reason: null }],
}
const question: AssistantQuestion = {
  id: 'octave',
  taskId: 'task',
  scope: { chatId: 'chat', messageId: 'reply' },
  prompt: 'Should the notes move up one octave for phone speakers?',
  options: [
    {
      id: 'up',
      label: 'Move up one octave',
      description: 'Keep all pitch intervals.',
    },
    { id: 'reject', label: 'UNSELECTED', description: 'Change the intervals.' },
  ],
  recommendedOptionId: 'up',
  status: 'answered',
  answer: {
    optionId: null,
    text: 'Move up one octave. Audio comes from professional equipment; the phone is only a controller.',
  },
}
const common = {
  status: 'completed' as const,
  scope: 'project' as const,
  contextServiceKey: modelProfileKey(config),
  sources: [],
}
function history(): [AssistantMessage, AssistantMessage] {
  return [
    {
      ...common,
      id: 'creator',
      role: 'user',
      text: 'Keep the fixed pitch mapping.',
    },
    {
      ...common,
      id: 'reply',
      role: 'assistant',
      text: 'STALE ASSISTANT CLAIM: phones output the audio.',
      questions: [question],
      sources: [
        projectPageSource(
          {
            path: 'score.js',
            version: 'v1',
            text: 'old code',
            offset: 0,
            endOffset: 8,
            totalCharacters: 8,
            nextOffset: null,
            startLine: 1,
            endLine: 1,
          },
          'en'
        ),
      ],
    },
  ]
}

it('retains both parts of a submitted answer when saved source invalidates the old model reply', () => {
  const records = history()
  const before = structuredClone(records)
  const selection = selectAssistantContext(records, config, project)
  expect(selection.recent).toEqual([])
  expect(selection.creatorRecords).toEqual([
    { sourceId: 'creator', kind: 'creatorInput', text: records[0]?.text },
    {
      sourceId: 'reply',
      kind: 'submittedAnswer',
      question: expect.objectContaining({
        id: 'octave',
        scope: question.scope,
        answer: question.answer,
        questionContext: expect.objectContaining({
          provenance: 'assistantQuestion',
        }),
      }),
    },
  ])
  const text = JSON.stringify(selection.creatorRecords)
  expect(text).toContain('Move up one octave.')
  expect(text).toContain('professional equipment')
  expect(text).not.toContain('STALE ASSISTANT CLAIM')
  expect(text).not.toContain('UNSELECTED')
  expect(records).toEqual(before)
})

it('preserves canonical answers through display-only restart and packet compaction without restoring authority', () => {
  const restored = restoreAssistantMessages({
    epoch: 'epoch',
    projectKey: 'project',
    appVersion: 'test',
    messages: history(),
  })
  const creatorRecords = creatorContextRecords(
    restored,
    modelProfileKey(config),
    project
  )
  const packet = buildAssistantMessages(restored, 'Continue the same goal.', {
    owner: 'project',
    config,
    projectReading: true,
    project,
    mode: 'discussion',
  })
  expect(
    packet.some(message => message.content?.includes('creatorRecords'))
  ).toBe(true)
  packet.push({ role: 'assistant', content: 'old commentary '.repeat(2000) })
  expect(
    compactWorkingContext(
      packet,
      {
        sources: [],
        completedText: '',
        pendingCandidates: [],
        handoff: null,
      },
      8000
    )
  ).toBe(true)
  expect(JSON.stringify(packet)).toContain(question.answer?.text)
  expect(JSON.stringify(creatorRecords)).not.toMatch(
    /grant|canExecute|resourceApproval/
  )
})

it('retains a real answer even if its assistant turn was interrupted, and keeps topic/service/project boundaries', () => {
  const records = history()
  records[1] = { ...records[1], status: 'cancelled' }
  expect(
    creatorContextRecords(records, modelProfileKey(config), project)
  ).toHaveLength(2)
  expect(creatorContextRecords(records, 'another-service', project)).toEqual([])
  expect(creatorContextRecords(records, modelProfileKey(config))).toEqual([])
  expect(
    creatorContextRecords(
      [
        ...records,
        {
          ...common,
          id: 'topic',
          role: 'assistant',
          text: '',
          contextMarker: { type: 'topic' },
        },
      ],
      modelProfileKey(config),
      project
    )
  ).toEqual([])
})

it('does not recover removed private material content through selected-answer records', () => {
  const records = history()
  const reply = records[1]
  const material = {
    id: 'a'.repeat(32),
    version: 'b'.repeat(64),
    name: 'Notes.txt',
    size: 10,
    totalCharacters: 10,
  }
  reply.sources.push({
    docId: material.id,
    sectionId: 'L1',
    title: 'Notes.txt',
    locale: 'en',
    version: material.version,
    material: {
      material,
      text: 'some notes',
      offset: 0,
      endOffset: 10,
      totalCharacters: 10,
      nextOffset: null,
      startLine: 1,
      endLine: 1,
    },
  })
  expect(
    creatorContextRecords(records, modelProfileKey(config), project, [])
  ).toHaveLength(1)
  expect(
    creatorContextRecords(records, modelProfileKey(config), project, [material])
  ).toHaveLength(2)
})

it('keeps a submitted material choice as intent while omitting its stale file excerpts and overwrite binding', () => {
  const records = history()
  records[1].questions = [
    {
      ...question,
      materialConflict: {
        materialId: 'a'.repeat(32),
        materialVersion: 'b'.repeat(64),
        path: 'score.js',
        targetVersion: 'v1',
        candidateSha256: 'c'.repeat(64),
        coexistPath: 'other.js',
        savedExcerpt: 'STALE SAVED CODE',
        candidateExcerpt: 'OLD CANDIDATE CODE',
        firstChangedLine: 1,
        truncated: false,
      },
    },
  ]
  const projected = JSON.stringify(
    creatorContextRecords(records, modelProfileKey(config), project)
  )
  expect(projected).toContain('professional equipment')
  expect(projected).not.toContain('STALE SAVED CODE')
  expect(projected).not.toContain('OLD CANDIDATE CODE')
  expect(projected).not.toContain('targetVersion')
})
