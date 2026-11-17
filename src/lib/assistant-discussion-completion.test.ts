import { expect, it, vi } from 'vitest'
import {
  runAssistantRequest,
  type AssistantDependencies,
} from './assistant-flow'
import type { AssistantTurn, AssistantWireMessage } from './assistant-types'
import type { AssistantTaskRunner } from './assistant-task-tools'
import { createAssistantTaskChecksFixture } from '@/test/assistant-task-checks-fixture'
import { HELP_BOOKS } from './help-corpus'

const plan = {
  reason: 'The creator resolved the only open decision.',
  intent: 'Keep a sustained tone while the touch remains active',
  plan: 'Keep a sustained tone while the touch remains active.\n\nChange audio.js. Release starts on touch-up or element expiry, and the tail finishes after expiry. Pause, Stop, seek and disconnection retain their previously confirmed behavior.\n\nAcceptance: a held touch never starts release before touch-up or expiry.',
  files: ['audio.js'],
  knownProblems: '',
  acceptance: 'A held touch never starts release before touch-up or expiry.',
}

function call(name: string, args: object) {
  return { id: name, name, arguments: JSON.stringify(args) }
}

function replay(
  turns: (
    | AssistantTurn
    | ((publish: (text: string) => void) => AssistantTurn)
  )[],
  onText?: (text: string) => void
) {
  const runner: AssistantTaskRunner = {
    task: { id: 'discussion-task', mode: 'discussion', files: [] },
    execute: vi.fn(),
    close: vi.fn().mockResolvedValue(undefined),
    checks: createAssistantTaskChecksFixture({
      identity: 'workspace',
      mode: 'discussion',
      task: () => runner.task,
      invokeProjectCheckTool: vi.fn(),
    }),
  }
  const packets: AssistantWireMessage[][] = []
  const turn = vi.fn<AssistantDependencies['turn']>(
    async (_, messages, publish) => {
      packets.push(structuredClone(messages))
      const next = turns.shift()
      if (typeof next === 'function') {
        if (!publish) throw new Error('Missing live text callback')
        return next(publish)
      }
      return next ?? { text: 'No structured completion.', toolCalls: [] }
    }
  )
  const dependencies: AssistantDependencies = {
    begin: async (_, requestId) => ({
      requestId,
      model: 'fixture',
      baseUrl: 'https://model.invalid',
    }),
    cancel: vi.fn().mockResolvedValue(undefined),
    corpus: async () =>
      HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\n\nLocal contract.`,
        }))
      ),
    turn,
    task: async () => runner,
    projectInventory: async () => ({ fingerprint: 'saved', files: [] }),
  }
  return {
    turn,
    runner,
    packets,
    result: runAssistantRequest(
      {
        identity: 'workspace',
        mode: 'discussion',
        input: 'Plan the sustained touch behavior.',
        history: [],
        locale: 'en',
        signal: new AbortController().signal,
        isCurrent: () => true,
        projectReading: true,
        project: { fingerprint: 'saved', files: [] },
        onText,
      },
      dependencies
    ),
  }
}

it('publishes a complete structured plan without replacing it with a later summary', async () => {
  const h = replay([
    {
      text: 'The complete plan follows in the structured result.',
      toolCalls: [call('propose_handoff', plan)],
    },
    { text: 'See the plan above and choose a button.', toolCalls: [] },
  ])
  const result = await h.result
  expect(result.text).toBe(plan.plan)
  expect(result.handoff).toEqual(plan)
  expect(h.turn).toHaveBeenCalledOnce()
  expect(h.runner.execute).not.toHaveBeenCalled()
})

it('repairs an omitted completion once without guessing readiness from prose', async () => {
  const h = replay([
    { text: plan.plan, toolCalls: [] },
    { text: null, toolCalls: [call('propose_handoff', plan)] },
  ])
  expect((await h.result).handoff).toEqual(plan)
  expect(h.turn).toHaveBeenCalledTimes(2)
})

it('finishes ordinary answers without a plan or work permission', async () => {
  const h = replay([
    {
      text: null,
      toolCalls: [
        call('complete_discussion', {
          answer: 'The output is routed through the host audio device.',
        }),
      ],
    },
  ])
  const result = await h.result
  expect(result.text).toBe(
    'The output is routed through the host audio device.'
  )
  expect(result.handoff).toBeUndefined()
  expect(h.turn).toHaveBeenCalledOnce()
  expect(h.runner.execute).not.toHaveBeenCalled()
})

it.each([
  {
    tool: 'complete_discussion',
    args: { answer: 'The output is routed through the host audio device.' },
    expected: 'The output is routed through the host audio device.',
  },
  { tool: 'propose_handoff', args: plan, expected: plan.plan },
])(
  'keeps streamed $tool text visible through final validation',
  async ({ tool, args, expected }) => {
    const publishText = vi.fn()
    const partial = expected.slice(0, 20)
    const h = replay(
      [
        publish => {
          publish(partial)
          return { text: null, toolCalls: [call(tool, args)] }
        },
      ],
      publishText
    )
    expect((await h.result).text).toBe(expected)
    expect(publishText.mock.calls).toEqual([[partial], [expected]])
  }
)

it('preserves the original public text after exactly one unsuccessful repair and creates no imaginary card', async () => {
  const h = replay([
    { text: 'A full draft. Choose Start work below.', toolCalls: [] },
    { text: 'A different shortened answer.', toolCalls: [] },
  ])
  const result = await h.result
  expect(result).toMatchObject({
    text: 'A full draft. Choose Start work below.',
    discussionIncomplete: true,
  })
  expect(result.handoff).toBeUndefined()
  expect(h.turn).toHaveBeenCalledTimes(2)
  expect(h.runner.execute).not.toHaveBeenCalled()
  expect(h.packets[1]?.at(-1)?.content).toContain('No action buttons exist')
})

it('refuses a malformed plan through the same contract without promising displayed controls', async () => {
  const publishText = vi.fn()
  const h = replay(
    [
      publish => {
        publish(plan.plan)
        return {
          text: '',
          toolCalls: [
            call('propose_handoff', { ...plan, files: ['../audio.js'] }),
          ],
        }
      },
      {
        text: '',
        toolCalls: [
          call('complete_discussion', {
            answer: 'The plan needs a valid project scope.',
          }),
        ],
      },
    ],
    publishText
  )
  const result = await h.result
  expect(result.handoff).toBeUndefined()
  const receipt = JSON.parse(h.packets[1]?.at(-1)?.content ?? '{}')
  expect(receipt.status).toBe('refused')
  expect(receipt.note).not.toContain('displayed')
  expect(h.runner.execute).not.toHaveBeenCalled()
  expect(publishText.mock.calls).toEqual([
    [plan.plan],
    [''],
    ['The plan needs a valid project scope.'],
  ])
})

it('keeps trigger, held behavior, ending and excluded transport actions in the identical public plan', async () => {
  const h = replay([
    { text: 'Short summary.', toolCalls: [call('propose_handoff', plan)] },
  ])
  const result = await h.result
  expect(result.text).toBe(result.handoff?.plan)
  expect(result.text).toContain('Release starts on touch-up or element expiry')
  expect(result.text).toContain(
    'Pause, Stop, seek and disconnection retain their previously confirmed behavior'
  )
  expect(result.text).toContain(
    'never starts release before touch-up or expiry'
  )
})

it('retains an over-limit public reply whole without trying to turn a truncated copy into a plan', async () => {
  const text = 'A'.repeat(32769)
  const h = replay([{ text, toolCalls: [] }])
  expect(await h.result).toMatchObject({ text, discussionIncomplete: true })
  expect(h.turn).toHaveBeenCalledOnce()
})
