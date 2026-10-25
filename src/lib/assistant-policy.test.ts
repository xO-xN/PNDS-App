import { expect, it } from 'vitest'
import { buildAssistantMessages } from './assistant-flow'
import { summaryInput } from './assistant-context'
import { modelProfileKey } from './model-context-settings'
import type { AssistantMessage } from './assistant-types'
import type { AssistantMode, AssistantQuestion } from './tauri-bindings'

const config = { model: 'chosen', baseUrl: 'https://model.example/v1' }
function messages(mode?: AssistantMode, purpose?: 'summary' | 'handoffDraft') {
  return buildAssistantMessages([], 'Preserve the fixed pitches.', {
    owner: 'project',
    config,
    projectReading: true,
    project: { fingerprint: 'saved', files: [] },
    mode,
    purpose,
  })
}

it('keeps project modes small and gives only discussion the design interview and next-step choice', () => {
  const discussion = messages('discussion')[0]
  const work = messages('edit')[0]
  expect(discussion?.contextKind).toBe('handoffPolicy')
  expect(discussion?.content).toContain('Mode: discussion')
  expect(discussion?.content).toContain('without writing files')
  expect(discussion?.content).toContain('ask_question')
  expect(discussion?.content).toContain('propose_handoff')
  expect(discussion?.content).toContain('numbers, units')
  expect(discussion?.content).toContain(
    'observable performer behavior and confirmed constraints'
  )
  expect(discussion?.content).toContain('Resolve consequential conflicts')
  expect(discussion?.content).toContain('never unresolved creative choices')
  expect(work?.contextKind).toBe('editPolicy')
  expect(work?.content).toContain('Mode: edit')
  expect(work?.content).toContain('Preserve the fixed pitches.')
  expect(work?.content).not.toContain('ask_question')
  expect(work?.content).not.toContain('propose_handoff')
  for (const packet of [discussion, work]) {
    expect(packet?.content?.length).toBeLessThan(2500)
    expect(packet?.content).not.toContain('adopt_creation_material')
    expect(packet?.content).not.toContain('createRequire')
    expect(packet?.content).not.toContain('install_preview_adapter')
  }
})

it('keeps structured drafting and summary isolated from implementation and document budgets', () => {
  const draft = messages('discussion', 'handoffDraft')[0]
  const summary = messages(undefined, 'summary')[0]
  expect(draft?.contextKind).toBe('handoffDraftPolicy')
  expect(draft?.content).toContain('confirmedRequirements')
  expect(draft?.content).toContain('creator/answer evidence')
  expect(draft?.content).toContain('not a new design or document-writing task')
  expect(draft?.content).toContain('acceptance must be exact excerpts')
  expect(draft?.content).toContain('never document formatting')
  expect(summary?.contextKind).toBe('summaryPolicy')
  expect(summary?.content).toContain('userDecisions')
  for (const packet of [draft, summary]) {
    expect(packet?.content?.length).toBeLessThan(1000)
    expect(packet?.content).not.toContain('Mode: edit')
    expect(packet?.content).not.toContain('Read limits:')
  }
})

it('sends selected answer meaning to later history and summaries without replaying unselected choices', () => {
  const question: AssistantQuestion = {
    id: 'pitch',
    taskId: 'design',
    scope: { chatId: 'chat', messageId: 'reply' },
    prompt: 'How should the colors determine pitch?',
    options: [
      {
        id: 'fixed',
        label: 'Fixed fundamentals',
        description: 'D2, A2, E4, B4; acceleration only +/-0.15 semitones.',
      },
      {
        id: 'free',
        label: 'UNSELECTED pitch mapping',
        description: 'UNSELECTED unconstrained glissando.',
      },
    ],
    recommendedOptionId: 'fixed',
    status: 'answered',
    answer: { optionId: 'fixed', text: null },
  }
  const common = {
    status: 'completed' as const,
    scope: 'project' as const,
    sources: [],
    contextServiceKey: modelProfileKey(config),
  }
  const history: AssistantMessage[] = [
    { ...common, id: 'creator', role: 'user', text: 'Design the instruments.' },
    {
      ...common,
      id: 'reply',
      role: 'assistant',
      text: 'Confirmed.',
      questions: [question],
    },
  ]
  const before = structuredClone(history)
  const project = { fingerprint: 'saved', files: [] }
  const packet = buildAssistantMessages(history, 'Continue this plan.', {
    owner: 'project',
    config,
    projectReading: true,
    project,
    mode: 'discussion',
  })
  const summary = summaryInput(
    [
      ...history,
      { ...common, id: 'later-user-1', role: 'user', text: 'Continue.' },
      { ...common, id: 'later-reply-1', role: 'assistant', text: 'Recorded.' },
      { ...common, id: 'later-user-2', role: 'user', text: 'Continue.' },
      { ...common, id: 'later-reply-2', role: 'assistant', text: 'Recorded.' },
    ],
    config,
    8,
    project
  )
  for (const contents of [JSON.stringify(packet), summary.input]) {
    expect(contents).toContain('D2, A2, E4, B4')
    expect(contents).toContain('0.15 semitones')
    expect(contents).not.toContain('UNSELECTED')
  }
  expect(history).toEqual(before)
})
