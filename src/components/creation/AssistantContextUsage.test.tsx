import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { commands, type ContextMeasurement } from '@/lib/tauri-bindings'
import { useAssistantStore } from '@/store/assistant-store'
import { CreationAssistant } from './CreationAssistant'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import { useAssistantOverviewStore } from '@/store/assistant-overview-store'
import { modelConfigurationKey } from '@/lib/model-context-settings'
import { HELP_BOOKS } from '@/lib/help-corpus'

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
  it('measures the same authorized overview that the highest workflow actually sends (#168/#169)', async () => {
    const config = { baseUrl: 'https://example.test/v1', model: 'fixture' }
    const snapshot = {
      files: [{ path: 'README.md', bytes: 12, version: 'v1', reason: null }],
      fingerprint: 'v1',
    }
    const overview = {
      snapshot,
      manifestStatus: 'valid',
      contentPaths: [],
      evidence: [
        {
          path: 'README.md',
          version: 'v1',
          text: '# Saved intent',
          offset: 0,
          endOffset: 14,
          totalCharacters: 14,
          nextOffset: null,
          startLine: 1,
          endLine: 1,
        },
      ],
    }
    useAssistantProjectStore.getState().syncWorkspace('usage-ui')
    useAssistantProjectStore.setState({
      reading: true,
      snapshot,
      authorization: {
        owner: 'usage-ui',
        service: modelConfigurationKey(config),
        paths: ['README.md'],
      },
    })
    useAssistantOverviewStore.getState().syncWorkspace('usage-ui')
    useAssistantOverviewStore.setState({ overview, stale: false })
    vi.mocked(commands.assistantProjectOverview).mockResolvedValue({
      status: 'ok',
      data: overview,
    })
    vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
      status: 'ok',
      data: snapshot,
    })
    vi.mocked(commands.beginAssistantRequest).mockImplementation(
      async (_owner, requestId) => ({
        status: 'ok',
        data: { requestId, ...config, config },
      })
    )
    vi.mocked(commands.helpCorpus).mockResolvedValue({
      status: 'ok',
      data: HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\n\nReference.`,
        }))
      ),
    })
    vi.mocked(commands.assistantModelTurn).mockResolvedValue({
      status: 'ok',
      data: { text: 'Answer', toolCalls: [] },
    })
    render(<CreationAssistant identity="usage-ui" />)
    await waitFor(() =>
      expect(
        vi
          .mocked(commands.measureAssistantContext)
          .mock.calls.at(-1)?.[1]
          .some(message => message.contextKind === 'projectOverview')
      ).toBe(true)
    )
    const preview = structuredClone(
      vi.mocked(commands.measureAssistantContext).mock.calls.at(-1)?.[1]
    )
    await act(() => useAssistantStore.getState().send())
    expect(
      vi.mocked(commands.assistantModelTurn).mock.calls.at(-1)?.[1]
    ).toEqual(preview)
    useAssistantProjectStore.getState().setReading(false)
  })
  it.each([
    [20, 'var(--pnds-context-low)'],
    [
      40,
      'color-mix(in srgb, var(--pnds-context-low) 50%, var(--pnds-context-mid))',
    ],
    [60, 'var(--pnds-context-mid)'],
    [
      80,
      'color-mix(in srgb, var(--pnds-context-mid) 50%, var(--pnds-context-high))',
    ],
    [100, 'var(--pnds-context-high)'],
  ] as const)(
    'colors the estimated %s%% share along the themed green/amber/red scale',
    async (percent, color) => {
      vi.mocked(commands.measureAssistantContext).mockResolvedValue({
        status: 'ok',
        data: {
          ...measurement,
          estimatedTokens: percent * 100,
          capacity: 10000,
        },
      })
      render(<CreationAssistant identity="usage-ui" />)
      const indicator = await screen.findByRole('button', {
        name: `Context: Estimated ${percent}%`,
      })
      expect(indicator.style.color).toBe(color)
    }
  )

  it('shows an explicitly estimated fraction from a generic reference tokenizer for any provider', async () => {
    useAssistantStore.setState({
      modelConfig: {
        model: 'any-vendor-model',
        baseUrl: 'https://other-provider.example/v1',
      },
    })
    vi.mocked(commands.measureAssistantContext).mockResolvedValue({
      status: 'ok',
      data: {
        ...measurement,
        estimatedTokens: null,
        tokenizer: 'unknown',
        referenceEstimatedTokens: 3000,
        capacity: 1_000_000,
      },
    })
    const user = userEvent.setup()
    render(<CreationAssistant identity="usage-ui" />)
    const indicator = await screen.findByRole('button', {
      name: 'Context: Estimated 0.3%',
    })
    expect(indicator).toHaveTextContent('Estimated 0.3%')
    await user.click(indicator)
    expect(screen.getByText(/Generic reference estimate/)).toBeVisible()
    expect(screen.getByText(/Smart zone/)).toBeVisible()
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  })

  it('keeps unknown usage when neither a selected nor a reference estimate is available', async () => {
    vi.mocked(commands.measureAssistantContext).mockResolvedValue({
      status: 'ok',
      data: { ...measurement, tokenizer: 'unknown', estimatedTokens: null },
    })
    const user = userEvent.setup()
    render(<CreationAssistant identity="usage-ui" />)
    await waitFor(() =>
      expect(commands.measureAssistantContext).toHaveBeenCalled()
    )
    await user.click(
      screen.getByRole('button', { name: 'Context: Token usage unknown' })
    )
    expect(screen.getByText(/— \/ 16,000 tokens/)).toBeVisible()
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument()
    expect(
      screen.queryByText(/recent original messages selected/)
    ).not.toBeInTheDocument()
  })

  it('does not round a tiny nonzero estimate to zero', async () => {
    vi.mocked(commands.measureAssistantContext).mockResolvedValue({
      status: 'ok',
      data: {
        ...measurement,
        estimatedTokens: null,
        referenceEstimatedTokens: 500,
        capacity: 1_000_000,
      },
    })
    render(<CreationAssistant identity="usage-ui" />)
    expect(
      await screen.findByRole('button', { name: 'Context: Estimated <0.1%' })
    ).toBeVisible()
  })

  it('requires configured capacity rather than inferring it from a model name', async () => {
    useAssistantStore.setState({
      modelConfig: {
        model: 'glm-5.3-flash',
        baseUrl: 'https://example.test/v1',
      },
    })
    vi.mocked(commands.measureAssistantContext).mockResolvedValue({
      status: 'ok',
      data: {
        ...measurement,
        estimatedTokens: null,
        referenceEstimatedTokens: 500,
        capacity: null,
      },
    })
    render(<CreationAssistant identity="usage-ui" />)
    expect(
      await screen.findByRole('button', {
        name: 'Context: Context capacity not set',
      })
    ).toBeVisible()
    expect(screen.queryByText(/\d+%/)).not.toBeInTheDocument()
  })

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
        screen.getByRole('button', { name: 'Context: Estimated 6.6%' })
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
    expect(screen.queryByText(/1,050 \/ 16,000 tokens/)).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Context: Estimated 6.6%' })
    )
    expect(screen.getByText(/1,050 \/ 16,000 tokens/)).toBeVisible()
    expect(screen.getByText(/manually entered capacity/)).toBeVisible()
    await user.keyboard('{Escape}')
    await user.click(screen.getByText(/Historical server usage/))
    expect(
      screen.getByText(/Known subtotal over 2 calls: 9000 input/)
    ).toBeVisible()
    expect(screen.getByText(/Call 2: unknown input/)).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Context: Estimated 6.6%' })
    ).toBeVisible()
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
  await user.click(screen.getByRole('button', { name: /Context:/ }))
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
  await user.keyboard('{Escape}')
  await user.click(screen.getByRole('button', { name: 'New chat' }))
  expect(useAssistantStore.getState().messages).toHaveLength(9)
  expect(useAssistantStore.getState().input).toBe('Explain outputChannels')
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
})
