import { beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { AssistantHistoryControls } from './AssistantHistoryControls'
import { AssistantMessageText } from './AssistantMessageText'
import { useAssistantStore } from '@/store/assistant-store'
import { commands } from '@/lib/tauri-bindings'
import { flushAssistantHistory } from '@/lib/assistant-history'
import { flushAssistantResume } from '@/lib/assistant-resume'
import { AssistantTaskLifecycle } from '@/lib/assistant-task-lifecycle'
import type { AssistantMessage } from '@/lib/assistant-types'
import type { AssistantContinuation } from '@/lib/assistant-flow'

const owner = 'history-recovery-fixture'
const taskId = '1700000000000000000-4242'
const goal = 'Preserve the held voice until its documented release event.'
const completeText = 'Complete saved reply. '.repeat(200) + 'END OF REPLY'

function completedReply(): AssistantMessage {
  return {
    id: 'reply',
    role: 'assistant',
    scope: 'project',
    status: 'completed',
    text: completeText,
    sources: [],
    checkOutcome: {
      schemaVersion: 1,
      taskId,
      savedPaths: ['supercollider/source/voice.scd'],
      staticCheck: { status: 'passed' },
      build: { status: 'passed', inputVersion: 'compiled-input' },
      projectTests: { status: 'failed' },
      runtime: { status: 'notRun' },
      behavior: { status: 'notRun' },
    },
  }
}

beforeEach(async () => {
  useAssistantStore.getState().syncWorkspace(null)
  await flushAssistantHistory()
  await flushAssistantResume()
  vi.clearAllMocks()
  vi.mocked(commands.loadAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: {
      epoch: 'fixture-epoch',
      projectKey: 'a'.repeat(64),
      appVersion: '1.7.0',
      messages: [],
    },
  })
  vi.mocked(commands.saveCreationAssistantResume).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.clearCreationAssistantResume).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  useAssistantStore.getState().syncWorkspace(owner)
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().historyState).toBe('ready')
  )
})

it('retains the complete reply and durable boundary across deterministic save rejection and explicit retry', async () => {
  const reply = completedReply()
  const user: AssistantMessage = {
    id: 'user',
    role: 'user',
    status: 'completed',
    scope: 'project',
    sources: [],
    text: goal,
  }
  const messages = [user, reply]
  let rejectCompletedSnapshot = true
  vi.mocked(commands.saveAssistantHistory).mockImplementation(
    async (_owner, _epoch, snapshot) =>
      rejectCompletedSnapshot && snapshot.some(message => message.checkOutcome)
        ? { status: 'error', error: { type: 'invalidFormat' } }
        : { status: 'ok', data: null }
  )
  const lifecycle = new AssistantTaskLifecycle(vi.fn())
  const run = lifecycle.start({
    owner,
    mode: 'edit',
    input: goal,
    userId: user.id,
    replyId: reply.id,
    conversationId: null,
    modelKey: 'fixture-service',
    locale: 'en',
    history: [],
    wholePlan: null,
    continuation: null,
    paused: false,
  })
  const boundary: AssistantContinuation = {
    taskId,
    key: 'fixture-request',
    projectFingerprint: 'saved',
    projectSnapshot: { fingerprint: 'saved', files: [] },
    messages: [{ role: 'user', content: goal, contextKind: 'input' }],
    sources: [],
    text: 'Last complete checkpoint',
    project: null,
    toolCalls: 1,
    toolCharacters: 0,
    callIds: [],
    calls: [],
    returnedCharacters: 0,
    reusedCharacters: 0,
    proposals: [],
    handoff: null,
  }
  await run.checkpoint(boundary)
  await run.complete(async () => {
    useAssistantStore.setState({ messages })
    await useAssistantStore.getState().persistHistory()
    return !useAssistantStore.getState().historySaveError
  })
  expect(commands.saveCreationAssistantResume).toHaveBeenCalledOnce()
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
  expect(useAssistantStore.getState().historySaveError).toBe('invalidFormat')
  expect(useAssistantStore.getState().messages).toEqual(messages)
  render(
    <>
      <AssistantHistoryControls identity={owner} />
      <AssistantMessageText message={reply} />
    </>
  )
  expect(screen.getByText(/END OF REPLY/)).toBeVisible()
  expect(screen.getByRole('alert')).toHaveTextContent(
    'The history snapshot did not pass format validation'
  )
  expect(screen.getByRole('alert')).not.toHaveTextContent('Retry loading')
  expect(screen.getByRole('alert')).not.toHaveTextContent('clear this project')
  await userEvent.click(
    screen.getByRole('button', { name: 'Retry saving history' })
  )
  await vi.waitFor(() =>
    expect(commands.saveAssistantHistory).toHaveBeenCalledTimes(2)
  )
  const attempts = vi.mocked(commands.saveAssistantHistory).mock.calls
  expect(attempts[1]?.[2]).toEqual(attempts[0]?.[2])
  expect(attempts[1]?.[2]).toEqual(messages)
  expect(useAssistantStore.getState().historySaveError).toBe('invalidFormat')
  expect(useAssistantStore.getState().messages).toEqual(messages)
  expect(commands.clearCreationAssistantResume).not.toHaveBeenCalled()
  expect(commands.clearAssistantHistory).not.toHaveBeenCalled()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()

  // Once the actual native rejection is repaired, retry can publish the exact
  // original reply and evidence without regenerating or trimming either.
  rejectCompletedSnapshot = false
  await userEvent.click(
    screen.getByRole('button', { name: 'Retry saving history' })
  )
  await act(() => flushAssistantHistory())
  expect(useAssistantStore.getState().historySaveError).toBeNull()
  expect(useAssistantStore.getState().messages).toEqual(messages)
  expect(commands.saveAssistantHistory).toHaveBeenLastCalledWith(
    owner,
    'fixture-epoch',
    messages
  )
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
})
