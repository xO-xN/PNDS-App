import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { commands, type ContextMeasurement } from '@/lib/tauri-bindings'
import { useAssistantStore } from '@/store/assistant-store'
import { CreationAssistant } from './CreationAssistant'

const measurement: ContextMeasurement = {
  characters: 3100,
  utf8Bytes: 4200,
  estimatedTokens: 1050,
  admissionEstimate: 1050,
  tokenizer: 'cl100kBase',
  capacity: 16000,
  effectiveInput: 11000,
  outputReserve: 4000,
  safetyMargin: 1000,
  exceeded: null,
  parts: [
    {
      kind: 'policyTools',
      characters: 2000,
      utf8Bytes: 2000,
      estimatedTokens: 500,
    },
  ],
}
beforeEach(() => {
  vi.clearAllMocks()
  useAssistantStore.getState().syncWorkspace(null)
  useAssistantStore.setState({
    owner: 'usage-ui',
    phase: 'idle',
    configured: true,
    historyState: 'ready',
    historyBusy: false,
    historySaveError: null,
    messages: [],
    input: 'Explain outputChannels',
    modelConfig: { baseUrl: 'https://example.test/v1', model: 'fixture' },
    contextMeasurement: null,
  })
  vi.mocked(commands.measureAssistantContext).mockResolvedValue({
    status: 'ok',
    data: measurement,
  })
})

describe('context and usage through the discussion (#233)', () => {
  it('measures the actual outgoing policy and input and separates historic consumption', async () => {
    useAssistantStore.setState({
      historicalMessageIds: ['old'],
      messages: [
        {
          id: 'old',
          role: 'assistant',
          text: 'Old answer',
          scope: 'platform',
          status: 'completed',
          sources: [],
          contextServiceKey: '["https://example.test/v1","fixture"]',
          usage: {
            calls: [
              {
                inputTokens: 9000,
                outputTokens: 200,
                cachedInputTokens: 10,
                reasoningTokens: null,
              },
              null,
            ],
            complete: false,
          },
        },
      ],
    })
    const user = userEvent.setup()
    render(<CreationAssistant identity="usage-ui" />)
    await waitFor(() =>
      expect(
        screen.getByText(/Next call context: About 1050 tokens/)
      ).toBeVisible()
    )
    const payload = vi
      .mocked(commands.measureAssistantContext)
      .mock.calls.at(-1)?.[1]
    expect(payload?.[0]).toMatchObject({
      role: 'system',
      content: expect.stringContaining('PNDS creation assistant'),
    })
    expect(payload?.at(-1)).toMatchObject({
      role: 'user',
      content: 'Explain outputChannels',
    })
    await user.click(screen.getByText(/Next call context/))
    expect(screen.getByText(/System policy and tool definitions/)).toBeVisible()
    expect(screen.getByText(/Manually entered capacity/)).toBeVisible()
    await user.click(screen.getByText(/Historical server usage/))
    expect(
      screen.getByText(/Known subtotal over 2 calls: 9000 input/)
    ).toBeVisible()
    expect(screen.getByText(/Call 2: unknown input/)).toBeVisible()
    expect(screen.queryByText(/%/)).not.toBeInTheDocument()
  })

  it('rejects a late preview after configuration changes', async () => {
    let finish!: (
      value: Awaited<ReturnType<typeof commands.measureAssistantContext>>
    ) => void
    vi.mocked(commands.measureAssistantContext).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    render(<CreationAssistant identity="usage-ui" />)
    await waitFor(() =>
      expect(commands.measureAssistantContext).toHaveBeenCalledTimes(1)
    )
    act(() =>
      useAssistantStore.setState({
        modelConfig: { baseUrl: 'https://other.test/v1', model: 'other' },
      })
    )
    await act(async () =>
      finish({
        status: 'ok',
        data: { ...measurement, estimatedTokens: 777777 },
      })
    )
    expect(screen.queryByText(/777777/)).not.toBeInTheDocument()
  })
})

it('previews organization without a paid call and changes a topic without clearing original records or input', async () => {
  const messages = Array.from({ length: 4 }, (_, index) => [
    {
      id: `ui-u${index}`,
      role: 'user' as const,
      text: `Question ${index}`,
      status: 'completed' as const,
      scope: 'platform' as const,
      sources: [],
      contextServiceKey: '["https://example.test/v1","fixture"]',
    },
    {
      id: `ui-a${index}`,
      role: 'assistant' as const,
      text: `Answer ${index}`,
      status: 'completed' as const,
      scope: 'platform' as const,
      sources: [],
      contextServiceKey: '["https://example.test/v1","fixture"]',
    },
  ]).flat()
  useAssistantStore.setState({ messages })
  const user = userEvent.setup()
  render(<CreationAssistant identity="usage-ui" />)
  await user.click(screen.getByRole('button', { name: 'Organize context' }))
  expect(
    await screen.findByText(/This action calls the current service/)
  ).toBeVisible()
  await waitFor(() =>
    expect(
      screen.getByRole('button', { name: 'Generate using current service' })
    ).toBeEnabled()
  )
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  await user.click(screen.getByRole('button', { name: 'New topic' }))
  expect(useAssistantStore.getState().messages).toHaveLength(9)
  expect(useAssistantStore.getState().input).toBe('Explain outputChannels')
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
})
