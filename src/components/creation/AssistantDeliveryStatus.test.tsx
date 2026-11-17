import { beforeEach, expect, it, vi } from 'vitest'
import { act, render, screen } from '@/test/test-utils'
import { AssistantDeliveryStatus } from './AssistantDeliveryStatus'
import {
  assistantDeliveryEvidence,
  type AssistantDeliveryEvidence,
} from '@/lib/assistant-delivery'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationStore } from '@/store/creation-store'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import { commands } from '@/lib/tauri-bindings'

beforeEach(() => vi.clearAllMocks())

it('shows the missing verification independently of a model completion claim', () => {
  const evidence = assistantDeliveryEvidence(
    {
      id: 'work',
      mode: 'edit',
      files: [
        { path: 'supercollider/source/pad.scd', created: false, undone: false },
      ],
    },
    JSON.stringify({
      status: 'partial',
      static: { staticPassed: true },
      runtime: { kind: 'liveObservation', savedChangesVerified: false },
    })
  )
  if (!evidence) throw new Error('Missing delivery evidence')
  render(<AssistantDeliveryStatus evidence={evidence} />)
  expect(screen.getByRole('region', { name: 'Delivery status' })).toBeVisible()
  expect(screen.getByText('Changes saved; verification remains')).toBeVisible()
  expect(
    screen.getByText(/This does not prove the new saved changes were loaded/)
  ).toBeVisible()
  expect(
    screen.getByText(/Compilation is required before delivery/)
  ).toBeVisible()
  expect(
    screen.getByText(
      /Interaction, sound and artistic fidelity remain unverified/
    )
  ).toBeVisible()
})

it('offers explicit verification continuation for a historical Work reply without a draft', () => {
  const evidence = pendingVerification()
  render(
    <AssistantDeliveryStatus evidence={evidence} messageId="old-work-reply" />
  )
  expect(
    screen.getByRole('button', { name: 'Continue verification (Work)' })
  ).toBeEnabled()
})

function pendingVerification(): AssistantDeliveryEvidence {
  const evidence: AssistantDeliveryEvidence = {
    schemaVersion: 1,
    taskId: 'old-native-task',
    savedPaths: ['score.js'],
    staticCheck: { status: 'passed' },
    build: { status: 'notRequired' },
    runtime: { status: 'observed', reason: 'existingRuntimeOnly' },
    behavior: { status: 'notRun', reason: 'behaviorNotVerified' },
  }
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'verification-owner',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useAssistantProjectStore.setState({ planning: false, whole: null })
  useAssistantStore.setState({
    owner: 'verification-owner',
    phase: 'idle',
    configured: true,
    modelConfig: { model: 'fixture', baseUrl: 'https://model.invalid' },
    input: '',
    activeConversationId: null,
    historyState: 'ready',
    historyBusy: false,
    historySaveError: null,
    activeQuestion: null,
    resourceApproval: null,
    editing: null,
    canContinue: false,
    paused: false,
    resumeRestored: false,
    organizing: false,
    historicalMessageIds: ['old-work-reply'],
    messages: [
      {
        id: 'original-goal',
        role: 'user',
        status: 'completed',
        scope: 'project',
        sources: [],
        text: 'Sustain while touched; release only on touch-up or expiry.',
      },
      {
        id: 'old-work-reply',
        role: 'assistant',
        status: 'completed',
        scope: 'project',
        sources: [],
        text: 'UNSELECTED assistant suggestion.',
        checkOutcome: evidence,
      },
    ],
  })
  return evidence
}

it.each(['draft', 'paused', 'continuation', 'busy', 'other-project'])(
  'blocks verification selection while %s without reviving the old task',
  async reason => {
    const evidence = pendingVerification()
    if (reason === 'draft')
      useAssistantStore.setState({ input: 'Keep my unsent idea' })
    if (reason === 'paused') useAssistantStore.setState({ paused: true })
    if (reason === 'continuation')
      useAssistantStore.setState({ canContinue: true })
    if (reason === 'busy') useAssistantStore.setState({ phase: 'reading' })
    if (reason === 'other-project')
      useAssistantStore.setState({ owner: 'another-project' })
    render(
      <AssistantDeliveryStatus evidence={evidence} messageId="old-work-reply" />
    )
    expect(
      screen.getByRole('button', { name: 'Continue verification (Work)' })
    ).toBeDisabled()
    await act(() =>
      useAssistantStore.getState().continueVerification('old-work-reply')
    )
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    expect(commands.beginCreationAssistantTask).not.toHaveBeenCalled()
    expect(commands.endCreationAssistantTask).not.toHaveBeenCalled()
    if (reason === 'draft')
      expect(useAssistantStore.getState().input).toBe('Keep my unsent idea')
  }
)

it.each(['no-goal', 'other-topic', 'verified'])(
  'has no verification action for %s evidence',
  reason => {
    const evidence = pendingVerification()
    if (reason === 'no-goal')
      useAssistantStore.setState(state => ({
        messages: state.messages.filter(message => message.role !== 'user'),
      }))
    if (reason === 'other-topic')
      useAssistantStore.setState({ activeConversationId: 'elsewhere' })
    if (reason === 'verified') {
      evidence.runtime.status = 'passed'
      evidence.behavior.status = 'passed'
    }
    render(
      <AssistantDeliveryStatus evidence={evidence} messageId="old-work-reply" />
    )
    expect(
      screen.queryByRole('button', { name: 'Continue verification (Work)' })
    ).not.toBeInTheDocument()
  }
)
