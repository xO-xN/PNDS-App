import { expect, it } from 'vitest'
import {
  handoffAnswerSources,
  handoffDraftInput,
  parseHandoffDraft,
  selectedDiscussionPlan,
  selectedHandoffTask,
} from './assistant-handoff'
import type { AssistantMessage } from './assistant-types'
import type { AssistantQuestion } from './tauri-bindings'

const question: AssistantQuestion = {
  id: 'pitch-question',
  taskId: 'task',
  scope: { chatId: 'chat', messageId: 'reply' },
  prompt: 'Which fixed pitches?',
  options: [
    {
      id: 'four',
      label: 'Four fixed pitches',
      description: 'Blue D2 / Red A2 / Green E4 / Orange B4.',
    },
    { id: 'eight', label: 'Eight pitches', description: 'UNSELECTED DETAILS' },
  ],
  recommendedOptionId: 'four',
  status: 'answered',
  answer: { optionId: 'four', text: null },
}
const reply: AssistantMessage = {
  id: 'reply',
  role: 'assistant',
  status: 'completed',
  text: 'Unaccepted suggestion.',
  scope: 'project',
  sources: [],
  questions: [question],
}

it('carries the selected option description into handoff sources and same-task answer sources', () => {
  for (const sources of [
    handoffDraftInput([reply]).sources,
    handoffAnswerSources([question]),
  ]) {
    const answer = sources.find(source => source.kind === 'answer')
    expect(answer?.text).toContain('Four fixed pitches')
    expect(answer?.text).toContain(question.options[0]?.description)
    expect(answer?.text).not.toContain('UNSELECTED DETAILS')
    expect(answer?.id).toBe('reply:pitch-question')
  }
})

it.each(['failed', 'cancelled'] as const)(
  'retains a submitted answer after %s generation without promoting incomplete prose',
  status => {
    const input = handoffDraftInput([{ ...reply, status }])
    expect(input.sources).toHaveLength(1)
    expect(input.sources[0]).toMatchObject({
      kind: 'answer',
      id: 'reply:pitch-question',
    })
    expect(input.input).not.toContain(reply.text)
    expect(input.input).toContain('Blue D2')
  }
)

it('keeps free-text answers distinct from an unselected recommendation', () => {
  const sources = handoffAnswerSources([
    { ...question, answer: { optionId: null, text: 'Use C3 and G3.' } },
  ])
  expect(sources[0]?.text).toContain('Use C3 and G3.')
  expect(sources[0]?.text).not.toContain('Blue D2')
})

it('grounds a selected full plan without accepting earlier suggestions or private activity', () => {
  const plan = {
    ...reply,
    text: 'Each color selects a fixed fundamental; acceleration only makes tiny pitch changes. Autonomous sound is out of scope.',
    activity: ['PRIVATE ACTIVITY'],
    reasoningContent: 'PRIVATE REASONING',
  }
  const sources = handoffDraftInput([
    { ...reply, id: 'earlier', text: 'UNACCEPTED GLISSANDO' },
    plan,
  ]).sources
  const selected = selectedDiscussionPlan(plan, {
    reason: 'Ready',
    intent: 'Implement the four instruments',
    files: ['score.js'],
    acceptance: 'Pitch remains near the selected fundamental.',
    knownProblems: 'Rendering has not been verified.',
  })
  expect(selected.kind).toBe('creator')
  expect(selected.text).toContain(plan.text)
  expect(selected.text).not.toContain('PRIVATE')
  expect(selected.text).not.toContain('UNACCEPTED GLISSANDO')
  expect(sources.find(source => source.id === 'earlier')?.kind).toBe(
    'suggestion'
  )
  const draft = {
    confirmedRequirements: [{ text: plan.text, sourceIds: [selected.id] }],
    acceptance: [
      { text: 'Verify tiny pitch changes.', sourceIds: [selected.id] },
    ],
    files: ['score.js'],
    suggestions: [{ text: 'UNACCEPTED GLISSANDO', sourceIds: ['earlier'] }],
    openQuestions: [],
  }
  expect(() => parseHandoffDraft(JSON.stringify(draft), sources)).toThrow()
  expect(
    parseHandoffDraft(JSON.stringify(draft), [...sources, selected])
  ).toMatchObject({ intent: expect.stringContaining(plan.text) })
})

const soundPlan =
  'Implement eight touch-gated instruments in audio/instruments.js.\nKeep each color in its fixed register and acceleration within +/-20 cents.\nAcceptance: each instrument must start and release; stopping releases every voice.'
const confirmedSound = Array.from({ length: 5 }, (_, index) => ({
  ...question,
  id: `decision-${index + 1}`,
  // A copied displayed plan keeps reference questions from its original chat.
  scope: { chatId: 'original-chat', messageId: 'original-reply' },
}))
const soundHistory: AssistantMessage[] = [
  {
    ...reply,
    id: 'sound-user',
    role: 'user',
    text: 'Design the instruments.',
    questions: [],
  },
  { ...reply, id: 'sound-plan', text: soundPlan, questions: confirmedSound },
  {
    ...reply,
    id: 'generate-action',
    role: 'user',
    text: '生成交接草稿',
    questions: [],
  },
]

it('keeps copied sound decisions but excludes a generation action from business authority', () => {
  const { sources } = handoffDraftInput(soundHistory)
  expect(sources.filter(source => source.kind === 'answer')).toHaveLength(5)
  expect(sources.some(source => source.id === 'generate-action')).toBe(false)
  const wrongTask = {
    confirmedRequirements: [
      {
        text: 'Only write a handoff; do not implement sound.',
        sourceIds: ['generate-action'],
      },
    ],
    acceptance: [
      { text: 'The document is saved.', sourceIds: ['generate-action'] },
    ],
    files: ['docs/creator-handoff.md'],
    suggestions: [],
    openQuestions: [],
  }
  expect(() => parseHandoffDraft(JSON.stringify(wrongTask), sources)).toThrow()
})

it('binds a newly selected historical plan and its decisions instead of generated implementation scope', () => {
  const plan = soundHistory[1]
  if (!plan) throw new Error('Missing sound plan fixture')
  const selected = selectedDiscussionPlan(plan)
  const sources = [...handoffDraftInput(soundHistory).sources, selected]
  const draft = {
    confirmedRequirements: [
      { text: 'Extracted summary.', sourceIds: [selected.id] },
    ],
    acceptance: [
      {
        text: 'each instrument must start and release; stopping releases every voice.',
        sourceIds: [selected.id],
      },
    ],
    files: ['audio/instruments.js'],
    suggestions: [],
    openQuestions: [],
  }
  const task = parseHandoffDraft(JSON.stringify(draft), sources)
  expect(task.intent).toContain(soundPlan)
  expect(task.intent).toContain('Four fixed pitches')
  expect(task.intent).toContain('Blue D2 / Red A2 / Green E4 / Orange B4.')
  expect(task.intent).not.toContain('UNSELECTED DETAILS')
  expect(() =>
    parseHandoffDraft(
      JSON.stringify({
        ...draft,
        files: ['docs/creator-handoff.md'],
        acceptance: [
          { text: 'The document is saved.', sourceIds: [selected.id] },
        ],
      }),
      sources
    )
  ).toThrow()
})

it('keeps genuine document tasks and refuses a draft with unresolved decisions', () => {
  const sources = handoffDraftInput([
    {
      ...reply,
      id: 'doc-task',
      role: 'user',
      text: 'Update README.md to describe the touch instruments.',
      questions: [],
    },
  ]).sources
  const draft = {
    confirmedRequirements: [
      { text: sources[0]?.text ?? '', sourceIds: ['doc-task'] },
    ],
    acceptance: [
      { text: 'README.md describes the instruments.', sourceIds: ['doc-task'] },
    ],
    files: ['README.md'],
    suggestions: [],
    openQuestions: [],
  }
  expect(parseHandoffDraft(JSON.stringify(draft), sources).files).toEqual([
    'README.md',
  ])
  expect(() =>
    parseHandoffDraft(
      JSON.stringify({
        ...draft,
        openQuestions: [{ text: 'Which register?', sourceIds: ['doc-task'] }],
      }),
      sources
    )
  ).toThrow('unresolved')
})

it('keeps a concrete selected card goal even when its public reply is brief', () => {
  const source = selectedDiscussionPlan(
    { ...reply, text: 'The plan is ready.', questions: [] },
    {
      reason: 'Ready',
      intent:
        'Implement eight independent touch instruments with fixed registers.',
      files: ['audio/instruments.js'],
      acceptance: 'Every instrument starts and releases.',
      knownProblems: 'Sound needs audition.',
    }
  )
  const task = selectedHandoffTask([source])
  expect(task?.intent).toContain(
    'Implement eight independent touch instruments with fixed registers.'
  )
  expect(task?.intent).toContain('The plan is ready.')
  expect(task?.files).toEqual(['audio/instruments.js'])
  expect(task?.acceptance).toBe('Every instrument starts and releases.')
})

it('routes a genuinely undecided empty draft to clarification rather than format repair', () => {
  const sources = handoffDraftInput([
    {
      ...reply,
      id: 'design-user',
      role: 'user',
      text: 'Design the instruments.',
      questions: [],
    },
  ]).sources
  expect(() =>
    parseHandoffDraft(
      JSON.stringify({
        confirmedRequirements: [],
        acceptance: [],
        files: [],
        suggestions: [],
        openQuestions: [
          { text: 'Which register?', sourceIds: ['design-user'] },
        ],
      }),
      sources
    )
  ).toThrow('unresolved')
})

it('keeps the meaning of different questions with the same short answer', () => {
  const sources = handoffDraftInput([
    {
      ...reply,
      questions: [
        {
          ...question,
          id: 'visual-scope',
          prompt: 'May the visual geometry change?',
          answer: { optionId: null, text: 'No' },
        },
        {
          ...question,
          id: 'external-scope',
          prompt: 'May external audio mode change?',
          answer: { optionId: null, text: 'No' },
        },
      ],
    },
  ]).sources
  const selected = selectedDiscussionPlan(reply, {
    reason: 'Ready',
    intent: 'Implement touch instruments.',
    files: ['audio/instruments.js'],
    acceptance: 'Verify the instruments.',
    knownProblems: 'None.',
  })
  const task = selectedHandoffTask([
    ...sources,
    selected,
    ...sources.filter(source => source.kind === 'answer'),
  ])
  expect(task?.intent).toContain('May the visual geometry change?')
  expect(task?.intent).toContain('May external audio mode change?')
  expect(task?.intent.match(/"text":"No"/g)).toHaveLength(2)
  expect(task?.intent).toContain('assistantQuestion')
})

it('writes one public plan with a concrete goal and retains unique legacy card details', () => {
  const goal = 'Implement eight touch instruments.'
  const publicPlan = [
    '## Instruments',
    'Each color has one fixed fundamental. Acceleration stays within 15 cents.',
    '## Acceptance',
    'Every instrument starts and releases without changing the visuals.',
  ].join('\n\n')
  const uniqueDetail = 'The bell keeps its own 2–4 s decay.'
  const known = 'Real-device latency has not been measured.'
  const selected = selectedDiscussionPlan(
    { ...reply, text: publicPlan, questions: [] },
    {
      reason: 'Ready',
      intent: `${goal}\n\n${publicPlan}\n\n${uniqueDetail}`,
      files: ['audio/instruments.js'],
      acceptance: 'Measure fixed fundamentals within 1 cent.',
      knownProblems: known,
    }
  )
  const task = selectedHandoffTask([selected])
  expect(task?.intent.startsWith(goal)).toBe(true)
  expect(task?.intent.split(publicPlan)).toHaveLength(2)
  expect(task?.intent.split(uniqueDetail)).toHaveLength(2)
  expect(task?.intent).toContain(known)
  expect(task?.intent).not.toContain('I select the following displayed plan')
  expect(task?.intent).not.toContain('Goal:')
  expect(task?.intent).not.toContain('Scope:')
  expect(task?.intent).not.toContain('Full plan:')
  expect(task?.intent).not.toContain(
    'Measure fixed fundamentals within 1 cent.'
  )
  expect(task?.files).toEqual(['audio/instruments.js'])
  expect(task?.acceptance).toBe('Measure fixed fundamentals within 1 cent.')
})

it('does not repeat card facts already present in the public plan', () => {
  const goal = 'Implement the instruments.'
  const facts = 'The bell keeps its 2–4 s decay; pitch stays within 15 cents.'
  const unknown = 'Real-device latency has not been measured.'
  const body = `${goal}\n\n${facts}\n\n${unknown}`
  const selected = selectedDiscussionPlan(
    { ...reply, text: body, questions: [] },
    {
      reason: 'Ready',
      intent: `${goal}\n\n${facts}`,
      files: ['score.js'],
      acceptance: 'Verify the instruments.',
      knownProblems: unknown,
    }
  )
  expect(selectedHandoffTask([selected])?.intent).toBe(body)
})

it('keeps unique single-newline legacy card facts without repeating the public sentence', () => {
  const publicPlan = 'Each color has a fixed pitch.'
  const selected = selectedDiscussionPlan(
    { ...reply, text: publicPlan, questions: [] },
    {
      reason: 'Ready',
      intent:
        'Implement instruments.\nEach color has a fixed pitch.\nBell decay is 2 seconds.\n  Keep the bell envelope.\n\nDo not change the visuals.',
      files: ['score.js'],
      acceptance: 'Verify the instruments.',
      knownProblems: publicPlan,
    }
  )
  const task = selectedHandoffTask([selected])
  expect(task?.intent).toBe(
    'Implement instruments.\n\nEach color has a fixed pitch.\n\nBell decay is 2 seconds.\n  Keep the bell envelope.\n\nDo not change the visuals.'
  )
})

it('preserves unique legacy fenced code and multiline context with shared headings', () => {
  const body = '## Example\n```js\nexisting();\n```'
  const unique =
    '## Example\n```js\nadditional();\nrelease(2);\n```\n\n- Keep the envelope\n  and its 2-second release.'
  const selected = selectedDiscussionPlan(
    { ...reply, text: body, questions: [] },
    {
      reason: 'Ready',
      intent: `Implement instruments.\n${unique}`,
      files: ['score.js'],
      acceptance: 'Verify the instruments.',
      knownProblems: body,
    }
  )
  expect(selectedHandoffTask([selected])?.intent).toBe(
    `Implement instruments.\n\n${body}\n\n${unique}`
  )
})
