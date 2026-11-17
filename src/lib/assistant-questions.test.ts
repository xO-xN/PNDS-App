import { expect, it } from 'vitest'
import {
  questionEvidence,
  reconcileQuestionReceipts,
} from './assistant-questions'
import type { AssistantQuestion } from './tauri-bindings'
import type { AssistantWireMessage } from './assistant-types'

const scope = { chatId: 'chat', messageId: 'reply' }
const answered: AssistantQuestion = {
  id: 'question',
  taskId: 'task',
  scope,
  prompt: 'Which octave?',
  options: [],
  recommendedOptionId: null,
  status: 'answered',
  answer: { optionId: null, text: 'One octave per row.' },
}
function receipt(): AssistantWireMessage {
  return {
    role: 'tool',
    toolCallId: 'original-call',
    content: JSON.stringify({
      status: 'awaitingCreatorAnswer',
      question: { ...answered, status: 'pending', answer: null },
      note: 'Wait for the answer.',
    }),
  }
}

it('replaces a stale waiting receipt and its waiting note, retaining the original tool call', () => {
  const message = receipt()
  reconcileQuestionReceipts([message], [answered], scope)
  expect(message.toolCallId).toBe('original-call')
  expect(JSON.parse(message.content ?? 'null')).toEqual({
    status: 'creatorAnswered',
    question: answered,
    note: expect.stringContaining('already submitted'),
  })
  const content = message.content
  reconcileQuestionReceipts([message], [answered], scope)
  expect(message.content).toBe(content)
})

it.each([
  { ...answered, id: 'different-question' },
  { ...answered, taskId: 'different-task' },
  { ...answered, scope: { ...scope, chatId: 'different-chat' } },
  { ...answered, scope: { ...scope, messageId: 'different-reply' } },
  { ...answered, status: 'pending' as const, answer: null },
])(
  'keeps unrelated or unresolved canonical facts out of the receipt: %j',
  question => {
    const message = receipt()
    const content = message.content
    reconcileQuestionReceipts([message], [question], scope)
    expect(message.content).toBe(content)
  }
)

it('preserves ordinary source text and cannot manufacture an answer without a current scope', () => {
  const messages: AssistantWireMessage[] = [
    { ...receipt(), role: 'user' },
    { role: 'tool', content: 'ordinary source text', toolCallId: 'read' },
    { role: 'tool', content: 'null', toolCallId: 'empty' },
    receipt(),
  ]
  const before = structuredClone(messages)
  reconcileQuestionReceipts(messages, [answered], undefined)
  expect(messages).toEqual(before)
  reconcileQuestionReceipts(messages, [answered], scope)
  expect(messages.slice(0, 3)).toEqual(before.slice(0, 3))
})

it('reports canonical cancellation without inventing an answer or resuming execution', () => {
  const message = receipt()
  reconcileQuestionReceipts(
    [message],
    [{ ...answered, status: 'cancelled', answer: null }],
    scope
  )
  expect(JSON.parse(message.content ?? 'null')).toMatchObject({
    status: 'creatorCancelled',
    question: { status: 'cancelled', answer: null },
  })
})

it('projects only the submitted choice while retaining its exact description and numeric constraints', () => {
  const question: AssistantQuestion = {
    ...answered,
    options: [
      {
        id: 'fixed',
        label: 'Four fixed pitches',
        description:
          'D2, A2, E4, B4; acceleration changes pitch by at most 0.15 semitones.',
      },
      {
        id: 'rejected',
        label: 'UNSELECTED CONTINUOUS PITCH',
        description: 'UNSELECTED FREE GLISSANDO',
      },
    ],
    answer: { optionId: 'fixed', text: null },
  }
  const before = structuredClone(question)
  const [evidence] = questionEvidence([question])
  expect(evidence).toMatchObject({
    id: question.id,
    taskId: question.taskId,
    status: 'answered',
    answer: { optionId: 'fixed', text: null },
    selectedOption: question.options[0],
  })
  expect(evidence).not.toHaveProperty('options')
  expect(JSON.stringify(evidence)).not.toContain('UNSELECTED')
  expect(question).toEqual(before)
})

it('retains pending choices and scoped material facts while treating free-text and cancellation as their actual statuses', () => {
  const materialConflict = {
    materialId: 'material',
    materialVersion: 'v1',
    path: 'public/score.js',
    targetVersion: 'saved',
    candidateSha256: 'candidate',
    coexistPath: 'public/new-score.js',
    savedExcerpt: 'Original artwork',
    candidateExcerpt: 'Supplied artwork',
    firstChangedLine: 1,
    truncated: false,
  }
  const pending: AssistantQuestion = {
    ...answered,
    options: [
      { id: 'keep', label: 'Keep both', description: 'Use a new path.' },
    ],
    status: 'pending',
    answer: null,
    materialConflict,
  }
  const evidence = questionEvidence([
    pending,
    answered,
    { ...answered, status: 'cancelled', answer: null },
  ])
  expect(evidence[0]).toMatchObject({
    status: 'pending',
    answer: null,
    options: pending.options,
    materialConflict,
  })
  expect(evidence[1]).toMatchObject({
    status: 'answered',
    answer: { optionId: null, text: 'One octave per row.' },
  })
  expect(evidence[1]).not.toHaveProperty('selectedOption')
  expect(evidence[2]).toMatchObject({ status: 'cancelled', answer: null })
  expect(evidence[2]).not.toHaveProperty('options')
})
