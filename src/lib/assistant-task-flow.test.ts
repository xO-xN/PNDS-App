import { expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  buildAssistantMessages,
  AssistantFlowError,
  type AssistantDependencies,
  type AssistantContinuation,
} from './assistant-flow'
import type { AssistantTaskRunner } from './assistant-task-tools'
import type {
  AssistantProjectSnapshot,
  AssistantTask,
  AssistantToolCall,
  AssistantQuestion,
} from './tauri-bindings'
import { HELP_BOOKS } from './help-corpus'
import type { AssistantWireMessage } from './assistant-types'
import {
  deserializeAssistantContinuation,
  serializeAssistantContinuation,
} from './assistant-resume'
function call(
  name: string,
  args: Record<string, unknown>,
  id: string
): AssistantToolCall {
  return { id, name, arguments: JSON.stringify(args) }
}
const initial: AssistantProjectSnapshot = {
  fingerprint: 'initial',
  files: [{ path: 'server.js', bytes: 10, version: 'v1', reason: null }],
}
function harness(mode: 'discussion' | 'edit') {
  let snapshot = structuredClone(initial)
  const packets: AssistantWireMessage[][] = []
  const names: string[] = []
  const close = vi.fn().mockResolvedValue(undefined)
  const task: AssistantTask = { id: 'native-task', mode, files: [] }
  const runner: AssistantTaskRunner = {
    task,
    needsCheck: false,
    close,
    execute: vi.fn(async (name, args) => {
      names.push(name)
      if (name === 'run_project_check') {
        runner.needsCheck = false
        return JSON.stringify({
          status:
            names.filter(name => name === 'run_project_check').length === 1
              ? 'failed'
              : 'passed',
          error: 'ReferenceError: start is not defined',
        })
      }
      const path = typeof args.path === 'string' ? args.path : 'manifest.json'
      task.files.push({ path, created: args.version === null, undone: false })
      runner.needsCheck = mode === 'edit'
      snapshot = {
        fingerprint: `changed-${names.length}`,
        files: [
          ...snapshot.files.filter(file => file.path !== path),
          { path, version: `v${names.length + 1}`, bytes: 20, reason: null },
        ],
      }
      return JSON.stringify({ status: 'saved', task, inventory: snapshot })
    }),
  }
  const deps: AssistantDependencies = {
    begin: async (_, requestId) => ({
      requestId,
      model: 'test',
      baseUrl: 'http://local',
    }),
    corpus: async () =>
      HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\n\nLocal contract.`,
        }))
      ),
    cancel: vi.fn().mockResolvedValue(undefined),
    projectInventory: async () => snapshot,
    task: vi.fn().mockResolvedValue(runner),
    turn: vi.fn(),
  }
  const request = {
    identity: 'owner',
    mode,
    input: 'Fix the project and save it',
    history: [],
    locale: 'en' as const,
    signal: new AbortController().signal,
    isCurrent: () => true,
    projectReading: true,
    project: initial,
  }
  return { deps, request, runner, names, packets, close }
}
it('resumes discussion with the submitted answer in its original tool receipt and can present the next-step plan', async () => {
  const h = harness('discussion')
  const scope = { chatId: 'current-chat', messageId: 'original-reply' }
  const question: AssistantQuestion = {
    id: 'pitch-question',
    taskId: h.runner.task.id,
    scope,
    prompt: 'What determines the octave?',
    options: [
      {
        id: 'row-octave',
        label: 'Grid row',
        description: 'One octave per row.',
      },
    ],
    recommendedOptionId: 'row-octave',
    status: 'pending',
    answer: null,
  }
  h.runner.execute = vi.fn(async name => {
    if (name !== 'ask_question') throw new Error('Discussion cannot write')
    h.runner.task.questions = [structuredClone(question)]
    return JSON.stringify({ status: 'awaitingCreatorAnswer', question })
  })
  h.deps.turn = vi.fn().mockResolvedValueOnce({
    text: 'Only the octave choice remains.',
    toolCalls: [
      call(
        'propose_handoff',
        {
          reason: 'Premature preview before the octave is settled.',
          intent: 'Use a freely chosen octave.',
          files: ['server.js'],
          knownProblems: 'Implementation is pending.',
          acceptance: 'Use the proposed octave.',
        },
        'premature-plan'
      ),
      call(
        'ask_question',
        {
          prompt: question.prompt,
          options: question.options,
          recommendedOptionId: question.recommendedOptionId,
        },
        'ask-octave'
      ),
    ],
  })
  const checkpoints: AssistantContinuation[] = []
  const request = {
    ...h.request,
    input: 'Discuss a fixed pitch mapping before implementation.',
    questionScope: scope,
    onContinuation: (value: AssistantContinuation | null) => {
      if (value) checkpoints.push(value)
    },
  }
  const waiting = await runAssistantRequest(request, h.deps)
  expect(waiting.question).toEqual(question)
  expect(h.deps.turn).toHaveBeenCalledOnce()
  const continuation = checkpoints.at(-1)
  if (!continuation) throw new Error('Missing waiting checkpoint')
  expect(continuation.handoff).toBeNull()
  const answer = { optionId: 'row-octave', text: null }
  h.runner.task.questions = [{ ...question, status: 'answered', answer }]
  const plan = {
    reason: 'The final creative choice is resolved.',
    intent: 'Map each grid row to a fixed octave.',
    files: ['server.js'],
    knownProblems: 'The mapping still needs implementation.',
    acceptance: 'The three rows use three fixed octaves.',
  }
  let turn = 0
  h.deps.turn = vi.fn(async (_, messages) => {
    h.packets.push(structuredClone(messages))
    return turn++ === 0
      ? {
          text: 'The confirmed mapping is ready.',
          toolCalls: [call('propose_handoff', plan, 'next-step')],
        }
      : { text: 'Choose Write handoff file or Start work.', toolCalls: [] }
  })
  const result = await runAssistantRequest({ ...request, continuation }, h.deps)
  const resumedMessages = h.packets[0] ?? []
  const receipt = JSON.parse(
    resumedMessages.find(message => message.toolCallId === 'ask-octave')
      ?.content ?? '{}'
  )
  expect(receipt).toMatchObject({
    status: 'creatorAnswered',
    question: { status: 'answered', answer },
  })
  expect(resumedMessages[0]?.content).toContain('Use the submitted answer now')
  expect(resumedMessages[0]?.content).not.toContain(
    'discuss confirmed choices in chat prose only'
  )
  expect(result.handoff).toEqual(plan)
  expect(h.deps.turn).toHaveBeenCalledTimes(2)
  expect(h.runner.execute).toHaveBeenCalledOnce()
  // Canonical reconciliation must not mutate the saved checkpoint input.
  expect(
    JSON.parse(
      continuation.messages.find(message => message.toolCallId === 'ask-octave')
        ?.content ?? '{}'
    ).question.status
  ).toBe('pending')
})
it('keeps tool-turn commentary separate from the final user answer', async () => {
  const h = harness('edit')
  const onActivity = vi.fn()
  let turn = 0
  h.deps.turn = async () =>
    turn++ === 0
      ? {
          text: 'Process note: checking the parameter declaration.',
          toolCalls: [call('run_project_check', {}, 'check')],
        }
      : { text: 'The controls are ready.', toolCalls: [] }
  const result = await runAssistantRequest({ ...h.request, onActivity }, h.deps)
  expect(result.text).toBe('The controls are ready.')
  expect(onActivity).toHaveBeenLastCalledWith([
    'Process note: checking the parameter declaration.',
  ])
})

it('refuses a handoff draft that clears unresolved decisions without asking the creator', async () => {
  const h = harness('discussion')
  const source = {
    id: 'creator',
    kind: 'creator' as const,
    text: 'Implement a 3.5-octave range in server.js; verify the full range.',
  }
  const draft = {
    confirmedRequirements: [{ text: source.text, sourceIds: [source.id] }],
    acceptance: [{ text: 'Verify the full range.', sourceIds: [source.id] }],
    files: ['server.js'],
    suggestions: [],
    openQuestions: [
      {
        text: 'The proposed 2.5-octave range conflicts with 3.5 octaves.',
        sourceIds: [source.id],
      },
    ],
  }
  h.deps.turn = vi
    .fn()
    .mockResolvedValueOnce({ text: JSON.stringify(draft), toolCalls: [] })
    .mockResolvedValueOnce({
      text: JSON.stringify({ ...draft, openQuestions: [] }),
      toolCalls: [],
    })
  await expect(
    runAssistantRequest(
      {
        ...h.request,
        purpose: 'handoffDraft',
        handoffDraftSources: [source],
      },
      h.deps
    )
  ).rejects.toMatchObject({ code: 'protocol' })
  expect(h.deps.turn).toHaveBeenCalledTimes(2)
  expect(h.runner.execute).not.toHaveBeenCalled()
})

it('asks about a handoff conflict and continues the same draft after its actual answer', async () => {
  const h = harness('discussion')
  const scope = { chatId: 'range-chat', messageId: 'range-draft' }
  const source = {
    id: 'creator',
    kind: 'creator' as const,
    text: 'Implement a 3.5-octave range in server.js; verify the full range.',
  }
  const question: AssistantQuestion = {
    id: 'range-conflict',
    taskId: h.runner.task.id,
    scope,
    prompt:
      'The confirmed range is 3.5 octaves, but the proposed plan says 2.5. Which should remain?',
    options: [
      {
        id: 'keep',
        label: 'Keep 3.5 octaves',
        description: 'Preserve the confirmed range.',
      },
      {
        id: 'change',
        label: 'Use 2.5 octaves',
        description: 'Explicitly replace the earlier range.',
      },
    ],
    recommendedOptionId: 'keep',
    status: 'pending',
    answer: null,
  }
  const draft = {
    confirmedRequirements: [{ text: source.text, sourceIds: [source.id] }],
    acceptance: [{ text: 'Verify the full range.', sourceIds: [source.id] }],
    files: ['server.js'],
    suggestions: [],
    openQuestions: [{ text: question.prompt, sourceIds: [source.id] }],
  }
  h.runner.execute = vi.fn(async name => {
    if (name !== 'ask_question')
      throw new Error('Drafting cannot implement work')
    h.runner.task.questions = [structuredClone(question)]
    return JSON.stringify({ status: 'awaitingCreatorAnswer', question })
  })
  h.deps.turn = vi
    .fn()
    .mockResolvedValueOnce({ text: JSON.stringify(draft), toolCalls: [] })
    .mockResolvedValueOnce({
      text: 'The range conflict needs your choice.',
      toolCalls: [
        call(
          'ask_question',
          {
            prompt: question.prompt,
            options: question.options,
            recommendedOptionId: question.recommendedOptionId,
          },
          question.id
        ),
      ],
    })
    .mockResolvedValueOnce({
      text: JSON.stringify({ ...draft, openQuestions: [] }),
      toolCalls: [],
    })
  const checkpoints: AssistantContinuation[] = []
  const request = {
    ...h.request,
    purpose: 'handoffDraft' as const,
    handoffDraftSources: [source],
    questionScope: scope,
    onContinuation: (value: AssistantContinuation | null) => {
      if (value) checkpoints.push(value)
    },
  }
  const waiting = await runAssistantRequest(request, h.deps)
  expect(waiting.question).toEqual(question)
  expect(waiting.handoffDraft).toBeUndefined()
  const continuation = checkpoints.at(-1)
  if (!continuation) throw new Error('Missing draft question checkpoint')
  await runAssistantRequest({ ...request, continuation }, h.deps)
  expect(h.deps.turn).toHaveBeenCalledTimes(2)
  h.runner.task.questions = [
    {
      ...question,
      status: 'answered',
      answer: { optionId: 'keep', text: null },
    },
  ]
  const result = await runAssistantRequest({ ...request, continuation }, h.deps)
  expect(result.handoffDraft?.intent).toContain('3.5-octave')
  expect(result.handoffDraft?.intent).not.toContain('2.5-octave')
  expect(h.deps.turn).toHaveBeenCalledTimes(3)
  expect(h.runner.execute).toHaveBeenCalledOnce()
  expect(h.runner.task.files).toEqual([])
  expect(h.deps.task).toHaveBeenLastCalledWith(
    'owner',
    'discussion',
    h.runner.task.id,
    expect.any(AbortSignal),
    undefined,
    request.input,
    scope
  )
})

it('keeps an unresolved handoff blocked across interruption and durable restore', async () => {
  const h = harness('discussion')
  const source = {
    id: 'creator',
    kind: 'creator' as const,
    text: 'Implement a 3.5-octave range in server.js.',
  }
  const draft = {
    confirmedRequirements: [{ text: source.text, sourceIds: [source.id] }],
    acceptance: [{ text: 'Verify 3.5 octaves.', sourceIds: [source.id] }],
    files: ['server.js'],
    suggestions: [],
    openQuestions: [
      { text: 'The proposed plan says 2.5 octaves.', sourceIds: [source.id] },
    ],
  }
  h.deps.turn = vi
    .fn()
    .mockResolvedValueOnce({ text: JSON.stringify(draft), toolCalls: [] })
    .mockResolvedValue({
      text: JSON.stringify({ ...draft, openQuestions: [] }),
      toolCalls: [],
    })
  const controller = new AbortController()
  let saved: AssistantContinuation | undefined
  const request = {
    ...h.request,
    purpose: 'handoffDraft' as const,
    handoffDraftSources: [source],
    signal: controller.signal,
    onContinuation: (value: AssistantContinuation | null) => {
      if (value?.handoffDraftClarificationAfter !== undefined) {
        saved = value
        controller.abort()
      }
    },
  }
  await expect(runAssistantRequest(request, h.deps)).rejects.toMatchObject({
    code: 'cancelled',
  })
  if (!saved) throw new Error('Missing unresolved draft checkpoint')
  const restored = deserializeAssistantContinuation(
    serializeAssistantContinuation(saved)
  )
  if (!restored) throw new Error('Invalid saved draft checkpoint')
  expect(restored.handoffDraftClarificationAfter).toBe(0)
  await expect(
    runAssistantRequest(
      {
        ...request,
        signal: new AbortController().signal,
        continuation: restored,
        onContinuation: undefined,
      },
      h.deps
    )
  ).rejects.toMatchObject({ code: 'protocol' })
  expect(h.deps.turn).toHaveBeenCalledTimes(3)
  expect(h.runner.execute).not.toHaveBeenCalled()
})

it('continues a design through dependent decisions before presenting its full plan in the same discussion task', async () => {
  const h = harness('discussion')
  const scope = { chatId: 'instrument-chat', messageId: 'instrument-reply' }
  const pitches: AssistantQuestion = {
    id: 'fixed-pitches',
    taskId: h.runner.task.id,
    scope,
    prompt: 'Which fixed fundamentals should the four colors use?',
    options: [
      {
        id: 'four-pitches',
        label: 'Four fixed pitches',
        description: 'Blue D2, red A2, green E4 and orange B4.',
      },
    ],
    recommendedOptionId: 'four-pitches',
    status: 'pending',
    answer: null,
  }
  const idleSound: AssistantQuestion = {
    id: 'idle-sound',
    taskId: h.runner.task.id,
    scope,
    prompt:
      'Should an untouched instrument remain silent or play autonomously?',
    options: [
      {
        id: 'silent',
        label: 'Remain silent',
        description: 'Exclude autonomous background sound from this task.',
      },
      {
        id: 'autonomous',
        label: 'Autonomous sound',
        description: 'Design another sound behavior while untouched.',
      },
    ],
    recommendedOptionId: 'silent',
    status: 'pending',
    answer: null,
  }
  const questions = [pitches, idleSound]
  h.runner.execute = vi.fn(async (name, args) => {
    if (name !== 'ask_question')
      throw new Error('The discussion must not write files or run checks')
    const question = questions.find(item => item.prompt === args.prompt)
    if (!question) throw new Error('Unexpected design question')
    expect(
      h.runner.task.questions?.some(item => item.id === question.id) ?? false
    ).toBe(false)
    h.runner.task.questions = [
      ...(h.runner.task.questions ?? []),
      structuredClone(question),
    ]
    return JSON.stringify({ status: 'awaitingCreatorAnswer', question })
  })
  const fullPlan = [
    'Implement four color instruments with fixed fundamentals: blue D2, red A2, green E4 and orange B4.',
    'The accelerometer adds only tiny tuning around each fundamental; it never selects another note or creates an independent glissando.',
    'An untouched instrument remains silent. Autonomous background sound is explicitly excluded from this task.',
    'Scope: server.js. Acceptance: verify all four fixed pitches, small accelerometer tuning and silence while untouched.',
    'Choose Write handoff file or Start work to use this same plan.',
  ].join('\n\n')
  const plan = {
    reason: 'The pitch mapping and untouched behavior are resolved.',
    intent: 'Implement the four fixed-pitch color instruments.',
    files: ['server.js'],
    knownProblems: 'Autonomous background sound is explicitly excluded.',
    acceptance:
      'Verify D2/A2/E4/B4, tiny accelerometer tuning and silence while untouched.',
  }
  let turn = 0
  h.deps.turn = vi.fn(async (_, messages) => {
    h.packets.push(structuredClone(messages))
    const current = turn++
    if (current < questions.length) {
      const question = questions[current]
      if (!question) throw new Error('Missing scripted question')
      return {
        text:
          current === 0
            ? 'Checking which fixed pitches to assign.'
            : 'Pitch table is settled; untouched behavior still needs a decision.',
        toolCalls: [
          call(
            'ask_question',
            {
              prompt: question.prompt,
              options: question.options,
              recommendedOptionId: question.recommendedOptionId,
            },
            question.id
          ),
        ],
      }
    }
    if (current === 2)
      return {
        text: 'The final scope is now ready for your choice.',
        toolCalls: [call('propose_handoff', plan, 'instrument-plan')],
      }
    if (current !== 3) throw new Error('The completed design must stop')
    return { text: fullPlan, toolCalls: [] }
  })
  const checkpoints: AssistantContinuation[] = []
  const onActivity = vi.fn()
  const request = {
    ...h.request,
    input:
      'Design four color instruments with fixed fundamentals. The accelerometer may only add tiny tuning around each fundamental.',
    questionScope: scope,
    onActivity,
    onContinuation: (value: AssistantContinuation | null) => {
      if (value) checkpoints.push(value)
    },
  }
  const latest = () => {
    const checkpoint = checkpoints.at(-1)
    if (!checkpoint) throw new Error('Missing discussion checkpoint')
    return checkpoint
  }
  const first = await runAssistantRequest(request, h.deps)
  expect(first.question).toEqual(pitches)
  expect(first.handoff).toBeUndefined()
  await runAssistantRequest({ ...request, continuation: latest() }, h.deps)
  expect(h.deps.turn).toHaveBeenCalledOnce()
  h.runner.task.questions = [
    {
      ...pitches,
      status: 'answered',
      answer: { optionId: 'four-pitches', text: null },
    },
  ]
  const second = await runAssistantRequest(
    { ...request, continuation: latest() },
    h.deps
  )
  expect(second.question).toEqual(idleSound)
  expect(second.handoff).toBeUndefined()
  expect(h.deps.turn).toHaveBeenCalledTimes(2)
  const pitchReceipt = JSON.parse(
    h.packets[1]?.find(message => message.toolCallId === pitches.id)?.content ??
      '{}'
  )
  expect(pitchReceipt).toMatchObject({
    status: 'creatorAnswered',
    question: { answer: { optionId: 'four-pitches' } },
  })
  await runAssistantRequest({ ...request, continuation: latest() }, h.deps)
  expect(h.deps.turn).toHaveBeenCalledTimes(2)
  h.runner.task.questions = h.runner.task.questions?.map(question =>
    question.id === idleSound.id
      ? {
          ...question,
          status: 'answered',
          answer: { optionId: 'silent', text: null },
        }
      : question
  )
  const result = await runAssistantRequest(
    { ...request, continuation: latest() },
    h.deps
  )
  expect(result.text).toBe(fullPlan)
  expect(result.handoff).toEqual(plan)
  expect(result.question).toBeUndefined()
  expect(h.deps.turn).toHaveBeenCalledTimes(4)
  expect(h.runner.execute).toHaveBeenCalledTimes(2)
  expect(vi.mocked(h.runner.execute).mock.calls.map(([name]) => name)).toEqual([
    'ask_question',
    'ask_question',
  ])
  expect(h.names).toEqual([])
  expect(h.runner.task.files).toEqual([])
  expect(h.packets[1]?.[0]?.content).toContain(
    'After each answer, examine remaining dependencies'
  )
  expect(h.packets[1]?.[0]?.content).toContain('preserve settled values')
  expect(JSON.stringify(h.packets[2])).toContain(request.input)
  const idleReceipt = JSON.parse(
    h.packets[2]?.find(message => message.toolCallId === idleSound.id)
      ?.content ?? '{}'
  )
  expect(idleReceipt).toMatchObject({
    status: 'creatorAnswered',
    question: { answer: { optionId: 'silent' } },
  })
  expect(h.deps.task).toHaveBeenLastCalledWith(
    'owner',
    'discussion',
    'native-task',
    expect.any(AbortSignal),
    undefined,
    request.input,
    scope
  )
  expect(onActivity).toHaveBeenLastCalledWith([
    'Checking which fixed pitches to assign.',
    'Pitch table is settled; untouched behavior still needs a decision.',
    'The final scope is now ready for your choice.',
  ])
})

it('publishes saved controls at final completion even when the model omitted the display tool', async () => {
  const h = harness('edit')
  h.deps.turn = async () => ({
    text: 'Saved the requested size.',
    toolCalls: [],
  })
  h.runner.prepareControls = vi.fn(async () => {
    h.runner.controls = [
      {
        id: 'control',
        path: 'score.js',
        version: 'v2',
        sourceText: 'let size = 4;',
        text: 'let size = 4;',
        parameters: [],
        binding: null,
        taskId: 'native-task',
      },
    ]
  })
  const result = await runAssistantRequest(h.request, h.deps)
  expect(h.runner.prepareControls).toHaveBeenCalledOnce()
  expect(result.proposals?.[0]).toMatchObject({
    id: 'control',
    taskId: 'native-task',
    version: 'v2',
  })
  expect(h.close).toHaveBeenCalledOnce()
})

it('saves new and coordinated files, adopts a local package, checks, and repairs in the same task', async () => {
  const h = harness('edit')
  let turn = 0
  h.deps.turn = async (_, messages) => {
    h.packets.push(structuredClone(messages))
    switch (turn++) {
      case 0:
        return {
          text: 'Implementing.',
          toolCalls: [
            call('use_local_library', { id: 'p5' }, 'a'),
            call(
              'create_project_file',
              {
                path: 'public/monitor.html',
                text: '<script src="/p5.js"></script>',
              },
              'b'
            ),
            call(
              'write_project_file',
              {
                path: 'server.js',
                version: 'v1',
                edits: [{ oldText: 'old', newText: 'start()' }],
              },
              'c'
            ),
          ],
        }
      case 1:
        return { text: 'Saved.', toolCalls: [] }
      case 2:
        expect(messages.at(-1)?.content).toContain('ReferenceError')
        return {
          text: 'Repairing startup.',
          toolCalls: [
            call(
              'write_project_file',
              {
                path: 'server.js',
                version: 'v4',
                edits: [{ oldText: 'start()', newText: 'listen()' }],
              },
              'd'
            ),
          ],
        }
      case 3:
        return { text: 'Ready to check again.', toolCalls: [] }
      default:
        return { text: 'Saved and checks passed.', toolCalls: [] }
    }
  }
  const result = await runAssistantRequest(h.request, h.deps)
  expect(h.deps.task).toHaveBeenCalledOnce()
  expect(h.names).toEqual([
    'use_local_library',
    'create_project_file',
    'write_project_file',
    'run_project_check',
    'write_project_file',
    'run_project_check',
  ])
  expect(h.close).toHaveBeenCalledOnce()
  expect(result.proposals).toBeUndefined()
  expect(h.packets[0]?.[0]?.contextKind).toBe('editPolicy')
  expect(h.packets[0]?.[0]?.content).toContain('Dependencies must be local')
  expect(h.packets.at(-1)?.at(-1)?.content).toContain('passed')
})
it('discussion refuses direct handoff writes and does not run implementation checks', async () => {
  const h = harness('discussion')
  let turn = 0
  h.deps.turn = async (_, messages) => {
    expect(messages[0]?.contextKind).toBe('handoffPolicy')
    return turn++ === 0
      ? {
          text: 'Recording confirmed requirements.',
          toolCalls: [
            call(
              'write_handoff',
              {
                path: 'docs/creator-handoff.md',
                version: null,
                text: '# Confirmed requirements\nFix routing',
              },
              'a'
            ),
          ],
        }
      : { text: 'Handoff saved.', toolCalls: [] }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(h.names).toEqual([])
  expect(h.close).toHaveBeenCalledOnce()
})
it('reuses the same native task on manual continuation after a model interruption', async () => {
  const h = harness('edit')
  let turn = 0
  let checkpoint: AssistantContinuation | null = null
  h.deps.turn = async () => {
    if (turn++ === 0)
      return {
        text: '',
        toolCalls: [
          call('create_project_file', { path: 'new.js', text: 'ok' }, 'a'),
        ],
      }
    throw new Error('provider interrupted')
  }
  await expect(
    runAssistantRequest(
      {
        ...h.request,
        onContinuation: value => {
          if (value) checkpoint = value
        },
      },
      h.deps
    )
  ).rejects.toThrow()
  expect(checkpoint).toMatchObject({ taskId: 'native-task' })
  h.deps.turn = async () => ({
    text: 'Continuing from saved changes.',
    toolCalls: [],
  })
  await runAssistantRequest(
    { ...h.request, continuation: checkpoint ?? undefined },
    h.deps
  )
  expect(h.deps.task).toHaveBeenLastCalledWith(
    'owner',
    'edit',
    'native-task',
    expect.any(AbortSignal),
    undefined,
    'Fix the project and save it'
  )
  expect(h.names.filter(name => name === 'create_project_file')).toHaveLength(1)
})

it('uses an explicit creation tool without a model-supplied saved version', async () => {
  const h = harness('edit')
  h.request.input = 'Create a new demonstration page and sketch.'
  let turn = 0
  h.deps.turn = async (_, messages) => {
    expect(messages[0]?.content).toContain(h.request.input)
    return turn++ === 0
      ? {
          text: 'Creating the missing page.',
          toolCalls: [
            call(
              'create_project_file',
              {
                path: 'public/monitor.html',
                text: '<!doctype html><script src="/monitor.js"></script>',
              },
              'new-page'
            ),
          ],
        }
      : { text: 'Created; report the check result.', toolCalls: [] }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(h.runner.execute).toHaveBeenCalledWith('create_project_file', {
    path: 'public/monitor.html',
    text: expect.any(String),
  })
})

it('replays moving original script content out of a misleading HTML extension without redesigning it', async () => {
  const h = harness('edit')
  const original =
    '// Original composition\nfunction setup() { createCanvas(320, 240) }\nfunction draw() { background(20); drawSequence() }\n'
  const saved: Record<string, string> = {
    'public/entry.html': original,
    'public/Geometry.js':
      'class Geometry { constructor() { this.columns = 7 } }\n',
    'public/Sequence.js': 'function drawSequence() { ellipse(20, 30, 40) }\n',
  }
  const before = { ...saved }
  let revision = 1
  const versions = new Map(Object.keys(saved).map(path => [path, 'v1']))
  const inventory = (): AssistantProjectSnapshot => ({
    fingerprint: `fixture-${revision}`,
    files: Object.entries(saved).map(([path, text]) => ({
      path,
      bytes: text.length,
      version: versions.get(path) ?? null,
      reason: null,
    })),
  })
  h.request.input =
    'Wire the existing composition to run. Preserve its original sketch and helper code.'
  h.request.project = inventory()
  h.deps.projectInventory = async () => inventory()
  h.deps.readProject = async (_, read) => {
    const text = saved[read.path]
    if (text === undefined) throw new Error('Missing fixture file')
    return {
      path: read.path,
      version: versions.get(read.path) ?? '',
      text,
      source: 'saved',
      offset: 0,
      endOffset: text.length,
      totalCharacters: text.length,
      nextOffset: null,
      startLine: 1,
      endLine: text.split('\n').length,
    }
  }
  h.runner.execute = vi.fn(async (name, args) => {
    h.names.push(name)
    if (name === 'run_project_check') {
      h.runner.needsCheck = false
      return JSON.stringify({
        status: 'passed',
        unverified: ['artisticFidelity'],
      })
    }
    if (typeof args.path !== 'string' || typeof args.text !== 'string')
      throw new Error('Unexpected fixture mutation')
    const path = args.path
    const created = saved[path] === undefined
    saved[path] = args.text
    versions.set(path, `v${++revision}`)
    h.runner.task.files.push({ path, created, undone: false })
    h.runner.needsCheck = true
    return JSON.stringify({
      status: 'saved',
      task: h.runner.task,
      inventory: inventory(),
    })
  })
  const shell =
    '<!doctype html><script src="/p5.js"></script><script src="/Geometry.js"></script><script src="/Sequence.js"></script><script src="/entry.js"></script>'
  let turn = 0
  // Scripted model fixture verifies App orchestration, not provider obedience
  // or the rendering of a private score project.
  h.deps.turn = async (_, messages) => {
    expect(messages[0]?.content).toContain('preserve existing artwork behavior')
    switch (turn++) {
      case 0:
        return {
          text: '',
          toolCalls: [
            call(
              'read_project_text',
              { path: 'public/entry.html' },
              'original-source'
            ),
          ],
        }
      case 1:
        expect(
          JSON.parse(messages.at(-1)?.content ?? '{}').segments[0].text
        ).toBe(original)
        return {
          text: '',
          toolCalls: [
            call(
              'create_project_file',
              { path: 'public/entry.js', text: original },
              'preserve-script'
            ),
            call(
              'write_project_file',
              { path: 'public/entry.html', version: 'v1', text: shell },
              'wire-page'
            ),
          ],
        }
      default:
        return {
          text: 'Moved the original script intact and wired the page. Visual fidelity still needs creator verification.',
          toolCalls: [],
        }
    }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(saved['public/entry.js']).toBe(original)
  expect(saved['public/Geometry.js']).toBe(before['public/Geometry.js'])
  expect(saved['public/Sequence.js']).toBe(before['public/Sequence.js'])
  expect(saved['public/entry.html']).toBe(shell)
  expect(h.names).toEqual([
    'create_project_file',
    'write_project_file',
    'run_project_check',
  ])
})

it('guides a misclassified new path to creation rather than demanding an impossible saved read', async () => {
  const h = harness('edit')
  let turn = 0
  h.deps.turn = async (_, messages) => {
    if (turn++ === 0)
      return {
        text: '',
        toolCalls: [
          call(
            'write_project_file',
            {
              path: 'public/monitor.html',
              version: 'null',
              text: '<html></html>',
            },
            'wrong-operation'
          ),
        ],
      }
    const result = JSON.parse(messages.at(-1)?.content ?? '{}')
    expect(result.reason).toBe('newFileRequiresCreateTool')
    expect(result.note).toContain('create_project_file')
    expect(result.note).not.toContain('complete saved read')
    return { text: 'Use the creation tool.', toolCalls: [] }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(h.runner.execute).not.toHaveBeenCalled()
})

it('treats edits:null as absent when replacing a fully read saved file', async () => {
  const h = harness('edit')
  let turn = 0
  h.deps.readProject = async () => ({
    path: 'server.js',
    version: 'v1',
    text: 'old server',
    source: 'saved',
    offset: 0,
    endOffset: 10,
    totalCharacters: 10,
    nextOffset: null,
    startLine: 1,
    endLine: 1,
  })
  h.deps.turn = async () => {
    switch (turn++) {
      case 0:
        return {
          text: '',
          toolCalls: [call('read_project_text', { path: 'server.js' }, 'read')],
        }
      case 1:
        return {
          text: '',
          toolCalls: [
            call(
              'write_project_file',
              {
                path: 'server.js',
                version: 'v1',
                text: 'new server',
                edits: null,
              },
              'replace'
            ),
          ],
        }
      default:
        return { text: 'Report the check.', toolCalls: [] }
    }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(h.runner.execute).toHaveBeenCalledWith('write_project_file', {
    path: 'server.js',
    version: 'v1',
    text: 'new server',
  })
})

it('refuses old handoff tools with no write capability', async () => {
  const h = harness('discussion')
  let turn = 0
  h.deps.turn = async (_, messages) => {
    if (turn++ === 0)
      return {
        text: '',
        toolCalls: [
          call(
            'write_handoff',
            {
              path: 'docs/creator-handoff.md',
              version: 'null',
              text: '# Handoff',
            },
            'new-handoff'
          ),
        ],
      }
    const result = JSON.parse(messages.at(-1)?.content ?? '{}')
    expect(result.reason).toBe('toolUnavailable')
    expect(result.note).not.toContain('write_handoff')
    expect(result.note).not.toContain('create_project_file')
    return { text: 'Use the handoff document tool.', toolCalls: [] }
  }
  await runAssistantRequest(h.request, h.deps)
})

it('recovers an output-truncated edit turn inside the same task without repeating saved changes', async () => {
  const h = harness('edit')
  let turn = 0
  h.deps.turn = async (_, messages) => {
    switch (turn++) {
      case 0:
        return {
          text: 'Adopting local p5.',
          toolCalls: [call('use_local_library', { id: 'p5' }, 'local-p5')],
        }
      case 1:
        throw new AssistantFlowError('outputTruncated')
      case 2:
        expect(messages[0]?.content).toContain(
          'Partial generation discarded after the output limit'
        )
        expect(
          messages.filter(message => message.role === 'tool')
        ).toHaveLength(1)
        return {
          text: 'Creating one small page.',
          toolCalls: [
            call(
              'create_project_file',
              {
                path: 'public/monitor.html',
                text: '<!doctype html><script src="/monitor.js"></script>',
              },
              'page-after-cutoff'
            ),
          ],
        }
      default:
        return {
          text: 'Saved; report the current check result.',
          toolCalls: [],
        }
    }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(h.deps.task).toHaveBeenCalledOnce()
  expect(h.names.filter(name => name === 'use_local_library')).toHaveLength(1)
  expect(h.names.filter(name => name === 'create_project_file')).toHaveLength(1)
  expect(h.close).toHaveBeenCalledOnce()
})

it('bounds automatic output recovery and preserves a checkpoint for an explicit retry', async () => {
  const h = harness('edit')
  let checkpoint: AssistantContinuation | null = null
  h.deps.turn = vi
    .fn()
    .mockRejectedValue(new AssistantFlowError('outputTruncated'))
  await expect(
    runAssistantRequest(
      {
        ...h.request,
        onContinuation: value => {
          if (value) checkpoint = value
        },
      },
      h.deps
    )
  ).rejects.toMatchObject({ code: 'outputTruncated' })
  expect(h.deps.turn).toHaveBeenCalledTimes(3)
  expect(checkpoint).toMatchObject({
    taskId: 'native-task',
    outputRecoveries: 2,
  })
  expect(h.close).toHaveBeenCalledOnce()
  expect(h.runner.execute).not.toHaveBeenCalled()
})

it('cancels cleanly during automatic output recovery before issuing another model turn', async () => {
  const h = harness('edit')
  const controller = new AbortController()
  h.deps.turn = vi
    .fn()
    .mockRejectedValue(new AssistantFlowError('outputTruncated'))
  await expect(
    runAssistantRequest(
      {
        ...h.request,
        signal: controller.signal,
        onPhase: phase => {
          if (phase === 'continuing') controller.abort()
        },
      },
      h.deps
    )
  ).rejects.toMatchObject({ code: 'cancelled' })
  expect(h.deps.turn).toHaveBeenCalledOnce()
  expect(h.runner.execute).not.toHaveBeenCalled()
  expect(h.close).toHaveBeenCalledOnce()
})

it('checkpoints a completed save before pausing and resumes without repeating the write', async () => {
  const h = harness('edit')
  const controller = new AbortController()
  let checkpoint: AssistantContinuation | null = null
  const execute = h.runner.execute
  let release!: () => void
  h.runner.execute = vi.fn(async (name, args) => {
    if (name === 'create_project_file')
      await new Promise<void>(resolve => {
        release = resolve
      })
    return execute(name, args)
  })
  h.deps.turn = vi
    .fn()
    .mockResolvedValueOnce({
      text: 'Create the page.',
      toolCalls: [
        call(
          'create_project_file',
          { path: 'public/monitor.html', text: '<html></html>' },
          'save-before-pause'
        ),
      ],
    })
    .mockResolvedValue({ text: 'Report the check.', toolCalls: [] })
  const running = runAssistantRequest(
    {
      ...h.request,
      pauseSignal: controller.signal,
      onContinuation: value => {
        checkpoint = value
      },
    },
    h.deps
  )
  await vi.waitFor(() => expect(release).toBeDefined())
  controller.abort()
  release()
  await expect(running).rejects.toMatchObject({ code: 'cancelled' })
  expect(checkpoint).toMatchObject({
    taskId: 'native-task',
    projectFingerprint: 'changed-1',
  })
  await runAssistantRequest(
    { ...h.request, continuation: checkpoint ?? undefined },
    h.deps
  )
  expect(h.names.filter(name => name === 'create_project_file')).toHaveLength(1)
  expect(h.deps.task).toHaveBeenLastCalledWith(
    'owner',
    'edit',
    'native-task',
    expect.any(AbortSignal),
    undefined,
    'Fix the project and save it'
  )
})

it('keeps the original implementation goal and handoff boundary explicit on every edit turn', async () => {
  const h = harness('edit')
  h.deps.turn = async (_, messages) => {
    expect(messages[0]?.content).toContain('Implement only the current task')
    expect(messages[0]?.content).toContain(h.request.input)
    return { text: 'Saved and checked the requested repair.', toolCalls: [] }
  }
  await runAssistantRequest(h.request, h.deps)
})

it('keeps existing-work preservation rules through manual continuation and working-context compaction', async () => {
  const h = harness('edit')
  h.request.input = 'Make the existing work run without changing its sketch.'
  const saved: { value: AssistantContinuation | null } = { value: null }
  const expectScope = (messages: AssistantWireMessage[]) => {
    const policy = messages[0]?.content ?? ''
    expect(policy).toContain(h.request.input)
    expect(policy).toContain('preserve existing artwork behavior')
    expect(policy).toContain('preserve creator drafts and excluded files')
    expect(policy).toContain('for requested tunable behavior')
  }
  let turn = 0
  h.deps.turn = async (_, messages) => {
    expectScope(messages)
    if (turn++ === 0)
      return {
        text: '',
        toolCalls: [call('list_project_files', {}, 'saved-inventory')],
      }
    throw new AssistantFlowError('protocol')
  }
  await expect(
    runAssistantRequest(
      {
        ...h.request,
        onContinuation: value => {
          if (value) saved.value = value
        },
      },
      h.deps
    )
  ).rejects.toMatchObject({ code: 'protocol' })
  if (!saved.value) throw new Error('Missing task checkpoint')
  // Model-free fixture: simulate old tool evidence accumulated before restart.
  saved.value.messages.splice(
    1,
    0,
    ...Array.from({ length: 40 }, () => ({
      role: 'user' as const,
      contextKind: 'projectFragment' as const,
      content: 'Earlier source observation. '.repeat(300),
    }))
  )
  const phases: string[] = []
  h.deps.turn = async (_, messages) => {
    expectScope(messages)
    expect(messages.some(message => message.contextKind === 'summary')).toBe(
      true
    )
    return {
      text: 'The original entry source is missing; provide it before the work can be restored.',
      toolCalls: [],
    }
  }
  await runAssistantRequest(
    {
      ...h.request,
      continuation: saved.value,
      onPhase: phase => phases.push(phase),
    },
    h.deps
  )
  expect(phases).toContain('compacting')
  expect(h.runner.execute).not.toHaveBeenCalled()
})

it('still cancels immediately if the workspace closes while a pause is waiting for a tool boundary', async () => {
  const h = harness('edit')
  const pause = new AbortController()
  const cancel = new AbortController()
  let release!: () => void
  h.runner.execute = vi.fn(async () => {
    await new Promise<void>(resolve => {
      release = resolve
    })
    return '{"status":"saved"}'
  })
  h.deps.turn = async () => ({
    text: 'Saving.',
    toolCalls: [
      call(
        'create_project_file',
        { path: 'new.js', text: 'saved' },
        'in-flight'
      ),
    ],
  })
  const running = runAssistantRequest(
    { ...h.request, signal: cancel.signal, pauseSignal: pause.signal },
    h.deps
  )
  await vi.waitFor(() => expect(release).toBeDefined())
  pause.abort()
  cancel.abort()
  await expect(running).rejects.toMatchObject({ code: 'cancelled' })
  expect(h.close).toHaveBeenCalledOnce()
  release()
})

it('classifies pause during native task preparation as cancellation rather than losing the resumable goal', async () => {
  const h = harness('edit')
  const pause = new AbortController()
  let release!: () => void
  h.deps.task = async (_identity, _mode, _resume, signal) => {
    await new Promise<void>(resolve => {
      release = resolve
    })
    if (signal.aborted) throw new Error('cancelled')
    return h.runner
  }
  const running = runAssistantRequest(
    { ...h.request, pauseSignal: pause.signal },
    h.deps
  )
  await vi.waitFor(() => expect(release).toBeDefined())
  pause.abort()
  release()
  await expect(running).rejects.toMatchObject({ code: 'cancelled' })
  expect(h.deps.turn).not.toHaveBeenCalled()
})

it('ends the model loop at a complete resource-proposal boundary and resumes the original goal with the creator decision', async () => {
  const h = harness('edit')
  const plan = {
    id: 'native-task-resources-1',
    reason: 'Restore client identity while preserving 1–9 selection',
    alternative: 'Keep the current HTTP transport',
    decision: 'pending' as 'pending' | 'approved',
    resources: [
      {
        kind: 'module' as const,
        id: 'players',
        version: '0.2.0',
        source: 'frozen',
      },
      {
        kind: 'library' as const,
        id: 'socket.io',
        version: '4.8.4',
        source: 'frozen',
      },
    ],
  }
  let checkpoint: AssistantContinuation | null = null
  h.runner.execute = vi.fn(async () => {
    h.runner.task.resourcePlans = [plan]
    return JSON.stringify({
      status: 'awaitingCreatorConfirmation',
      task: h.runner.task,
    })
  })
  h.deps.turn = vi.fn(async () => ({
    text: 'I recommend the local connection module.',
    reasoningContent: 'internal protocol data',
    toolCalls: [
      call(
        'propose_local_resources',
        {
          modules: ['players'],
          libraries: ['socket.io'],
          reason: plan.reason,
          alternative: plan.alternative,
        },
        'resource-proposal'
      ),
    ],
  }))
  const waiting = await runAssistantRequest(
    {
      ...h.request,
      onContinuation: value => {
        checkpoint = value
      },
    },
    h.deps
  )
  expect(waiting.resourcePlan).toEqual(plan)
  expect(h.deps.turn).toHaveBeenCalledOnce()
  expect(h.close).toHaveBeenCalledOnce()
  const saved = checkpoint as AssistantContinuation | null
  expect(saved?.messages.at(-1)).toMatchObject({
    role: 'tool',
    toolCallId: 'resource-proposal',
  })
  expect(saved?.messages.at(-2)).toMatchObject({
    reasoningContent: 'internal protocol data',
  })
  plan.decision = 'approved'
  h.deps.turn = vi.fn(async (_: string, messages: AssistantWireMessage[]) => {
    expect(messages[0]?.content).toContain('"decision":"approved"')
    expect(
      messages.filter(message => message.role === 'user').at(-1)?.content
    ).toContain(h.request.input)
    return {
      text: 'The requested performer page is implemented and checked.',
      toolCalls: [],
    }
  })
  const done = await runAssistantRequest(
    { ...h.request, continuation: saved ?? undefined },
    h.deps
  )
  expect(done.resourcePlan).toBeUndefined()
  expect(h.deps.turn).toHaveBeenCalledOnce()
  expect(h.runner.execute).toHaveBeenCalledOnce()
})

it('waits for one explicit creator answer before continuing the same edit task', async () => {
  const h = harness('edit')
  const question = {
    id: 'question-one',
    taskId: 'native-task',
    scope: { chatId: 'original', messageId: 'reply' },
    prompt: 'Should the pulses follow each performer or the whole ensemble?',
    options: [
      {
        id: 'individual',
        label: 'Each performer',
        description: 'Preserves individual timing.',
      },
      {
        id: 'ensemble',
        label: 'Whole ensemble',
        description: 'Shares one timing source.',
      },
    ],
    recommendedOptionId: 'individual',
    status: 'pending' as const,
    answer: null,
  }
  const execute = h.runner.execute
  h.runner.execute = vi.fn(async (name, args) => {
    if (name === 'ask_question') {
      h.runner.task.questions = [question]
      return JSON.stringify({ status: 'awaitingCreatorAnswer', question })
    }
    return execute(name, args)
  })
  let continuation: AssistantContinuation | null = null
  h.deps.turn = vi.fn().mockResolvedValue({
    text: '',
    toolCalls: [
      call(
        'ask_question',
        {
          prompt: question.prompt,
          options: question.options,
          recommendedOptionId: 'individual',
        },
        'q'
      ),
      call(
        'create_project_file',
        { path: 'decision.js', text: 'unsubmitted' },
        'premature'
      ),
      call(
        'ask_question',
        { prompt: 'Another?', options: [], recommendedOptionId: null },
        'second'
      ),
    ],
  })
  const request = {
    ...h.request,
    questionScope: question.scope,
    onContinuation: (value: AssistantContinuation | null) => {
      if (value) continuation = value
    },
  }
  const waiting = await runAssistantRequest(request, h.deps)
  expect(waiting.question).toEqual(question)
  expect(h.deps.turn).toHaveBeenCalledOnce()
  expect(h.runner.execute).toHaveBeenCalledOnce()
  expect(h.names).toEqual([])
  expect(
    (continuation as AssistantContinuation | null)?.messages.at(-1)?.content
  ).toContain('awaitingCreatorAnswer')
  // A displayed recommendation is not an answer. Continue while pending only
  // revalidates the task and displays the same question, with no model request.
  const saved = continuation as AssistantContinuation | null
  if (!saved) throw new Error('Missing completed question checkpoint')
  await runAssistantRequest({ ...request, continuation: saved }, h.deps)
  expect(h.deps.turn).toHaveBeenCalledOnce()
  h.runner.task.questions = [
    {
      ...question,
      status: 'answered',
      answer: { optionId: null, text: 'Each performer, with a shared ending.' },
    },
  ]
  h.deps.turn = vi.fn(async (_, messages) => {
    expect(messages[0]?.content).toContain(
      'Each performer, with a shared ending.'
    )
    expect(messages[0]?.content).toContain('Fix the project and save it')
    return h.names.includes('create_project_file')
      ? { text: 'Saved individual timing and a shared ending.', toolCalls: [] }
      : {
          text: '',
          toolCalls: [
            call(
              'create_project_file',
              {
                path: 'decision.js',
                text: 'performerTimingWithSharedEnding()',
              },
              'after-answer'
            ),
          ],
        }
  })
  const result = await runAssistantRequest(
    { ...request, continuation: saved },
    h.deps
  )
  expect(result.text).toContain('individual timing')
  expect(h.deps.task).toHaveBeenLastCalledWith(
    'owner',
    'edit',
    'native-task',
    expect.any(AbortSignal),
    undefined,
    h.request.input,
    question.scope
  )
  expect(h.names).toEqual(['create_project_file', 'run_project_check'])
})

it('retains submitted question facts in later conversations and reviewed context summaries', async () => {
  const { summaryInput } = await import('./assistant-context')
  const { modelProfileKey } = await import('./model-context-settings')
  const config = { model: 'test', baseUrl: 'http://local' }
  const records = Array.from({ length: 4 }, (_, index) => [
    {
      id: `user-${index}`,
      role: 'user' as const,
      text: 'Discuss the ending',
      status: 'completed' as const,
      scope: 'project' as const,
      sources: [],
      contextServiceKey: modelProfileKey(config),
    },
    {
      id: `reply-${index}`,
      role: 'assistant' as const,
      text: 'A performer-led ending.',
      status: 'completed' as const,
      scope: 'project' as const,
      sources: [],
      contextServiceKey: modelProfileKey(config),
      questions: [
        {
          id: `question-${index}`,
          taskId: `task-${index}`,
          scope: { chatId: 'original', messageId: `reply-${index}` },
          prompt: 'Who ends the piece?',
          options: [],
          recommendedOptionId: null,
          status: 'answered' as const,
          answer: {
            optionId: null,
            text: 'Each performer decides independently.',
          },
        },
      ],
    },
  ]).flat()
  const messages = buildAssistantMessages(
    records,
    'How does this affect duration?',
    {
      owner: 'owner',
      config,
      projectReading: true,
      mode: 'discussion',
      project: initial,
    }
  )
  expect(JSON.stringify(messages)).toContain(
    'Each performer decides independently.'
  )
  expect(JSON.stringify(messages)).toContain('reference only')
  expect(summaryInput(records, config, 8, initial).input).toContain(
    'Each performer decides independently.'
  )
})

it('offers the two discussion next steps as a read-only preview without dispatching writes or checks', async () => {
  const h = harness('discussion')
  let round = 0
  const plan = {
    reason: 'The choices are resolved.',
    intent: 'Use slow breathing for sparse rhythm',
    files: ['server.js'],
    knownProblems: 'Actual artistic effect needs verification.',
    acceptance: 'Preserve sound and verify density.',
  }
  h.deps.turn = async (_, messages) => {
    h.packets.push(structuredClone(messages))
    return round++ === 0
      ? {
          text: 'The plan is ready.',
          toolCalls: [call('propose_handoff', plan, 'plan')],
        }
      : { text: 'Choose a handoff file or Start work.', toolCalls: [] }
  }
  const result = await runAssistantRequest(h.request, h.deps)
  expect(result.handoff).toEqual(plan)
  expect(h.names).toEqual([])
  expect(h.runner.execute).not.toHaveBeenCalled()
  expect(h.packets[0]?.[0]?.content).toContain(
    'answers and previews do not authorize either route'
  )
  expect(
    h.packets.at(-1)?.find(message => message.role === 'tool')?.content
  ).toContain('No task or baseline was written')
})

it('uses the same PNDS organization constraints for a selected discussion plan as for a direct command', async () => {
  const h = harness('edit')
  h.request.input =
    'Implement the plan I selected.\nGoal: Organize the project\nScope: server.js\nAcceptance: Preserve the original behavior.'
  h.deps.turn = async (_, messages) => {
    expect(messages[0]?.content).toContain('PNDS default organization rules')
    expect(messages[0]?.content).toContain('Current task:')
    return { text: 'No safe cleanup needed.', toolCalls: [] }
  }
  await runAssistantRequest(h.request, h.deps)
  expect(h.runner.execute).not.toHaveBeenCalled()
})
