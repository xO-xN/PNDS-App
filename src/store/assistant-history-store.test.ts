import { beforeEach, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useAssistantStore } from './assistant-store'
import { flushAssistantHistory } from '@/lib/assistant-history'
import { HELP_BOOKS } from '@/lib/help-corpus'
import type { AssistantMessage } from '@/lib/assistant-types'

const message = (text = 'Old local record'): AssistantMessage => ({
  id: 'old',
  role: 'assistant',
  text,
  status: 'completed',
  sources: [],
  scope: 'platform',
})
const history = (
  messages: AssistantMessage[] = [],
  epoch = 'initial-epoch'
) => ({ epoch, projectKey: 'a'.repeat(64), appVersion: '1.6.5', messages })
async function open() {
  useAssistantStore.getState().syncWorkspace('project')
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().historyState).toBe('ready')
  )
}

beforeEach(async () => {
  useAssistantStore.getState().syncWorkspace(null)
  await flushAssistantHistory()
  vi.clearAllMocks()
  vi.mocked(commands.loadAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: history(),
  })
  vi.mocked(commands.saveAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.clearAssistantHistory).mockResolvedValue({
    status: 'ok',
    data: history([], 'cleared-epoch'),
  })
})

it('blocks automatic overwrite and sending after a load failure, then recovers by explicit reload', async () => {
  vi.mocked(commands.loadAssistantHistory).mockResolvedValueOnce({
    status: 'error',
    error: { type: 'unsupportedVersion' },
  })
  useAssistantStore.getState().syncWorkspace('project')
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().historyState).toBe('error')
  )
  useAssistantStore.setState({ configured: true })
  useAssistantStore.getState().setInput('Keep this input')
  await useAssistantStore.getState().send()
  await useAssistantStore.getState().persistHistory()
  expect(useAssistantStore.getState().messages).toEqual([])
  expect(commands.saveAssistantHistory).not.toHaveBeenCalled()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  await useAssistantStore.getState().retryHistory()
  expect(useAssistantStore.getState().historyState).toBe('ready')
  expect(useAssistantStore.getState().input).toBe('Keep this input')
})

it('retains live records and exposes a failed save until explicit saving succeeds', async () => {
  await open()
  useAssistantStore.setState({ messages: [message()] })
  vi.mocked(commands.saveAssistantHistory).mockResolvedValueOnce({
    status: 'error',
    error: { type: 'io' },
  })
  await useAssistantStore.getState().persistHistory()
  expect(useAssistantStore.getState().historySaveError).toBe('io')
  expect(useAssistantStore.getState().messages).toEqual([message()])
  await useAssistantStore.getState().persistHistory()
  expect(useAssistantStore.getState().historySaveError).toBeNull()
  expect(useAssistantStore.getState().historySaving).toBe(false)
})

it('keeps records, input and epoch after failed clear, and clears only on confirmed success', async () => {
  await open()
  useAssistantStore.setState({ messages: [message()] })
  useAssistantStore.getState().setInput('Retained draft')
  vi.mocked(commands.clearAssistantHistory).mockResolvedValueOnce({
    status: 'error',
    error: { type: 'io' },
  })
  await useAssistantStore.getState().clearHistory()
  expect(useAssistantStore.getState().messages).toEqual([message()])
  expect(useAssistantStore.getState().historyEpoch).toBe('initial-epoch')
  expect(useAssistantStore.getState().historyError).toBe('io')
  expect(useAssistantStore.getState().historyState).toBe('ready')
  await useAssistantStore.getState().clearHistory()
  expect(useAssistantStore.getState().messages).toEqual([])
  expect(useAssistantStore.getState().historyEpoch).toBe('cleared-epoch')
  expect(useAssistantStore.getState().input).toBe('Retained draft')
})

it('a queued save from before clear retains its old epoch and cannot resurrect cleared records', async () => {
  await open()
  let epoch = 'initial-epoch'
  let persisted: AssistantMessage[] = []
  let finish!: (
    value: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
  ) => void
  vi.mocked(commands.saveAssistantHistory)
    .mockImplementation(async (_owner, expected, messages) => {
      if (expected !== epoch)
        return { status: 'error', error: { type: 'staleHistory' } }
      persisted = structuredClone(messages)
      return { status: 'ok', data: null }
    })
    .mockImplementationOnce((_owner, _expected, messages) => {
      persisted = structuredClone(messages)
      return new Promise(resolve => {
        finish = resolve
      })
    })
  vi.mocked(commands.clearAssistantHistory).mockImplementation(async () => {
    epoch = 'cleared-epoch'
    persisted = []
    return { status: 'ok', data: history([], epoch) }
  })
  useAssistantStore.setState({ messages: [message('First record')] })
  const first = useAssistantStore.getState().persistHistory()
  useAssistantStore.setState({ messages: [message('Queued old record')] })
  const second = useAssistantStore.getState().persistHistory()
  await vi.waitFor(() => expect(finish).toBeDefined())
  await useAssistantStore.getState().clearHistory()
  finish({ status: 'ok', data: null })
  await Promise.all([first, second])
  expect(persisted).toEqual([])
  expect(useAssistantStore.getState().messages).toEqual([])
  expect(useAssistantStore.getState().historySaveError).toBeNull()
  expect(vi.mocked(commands.saveAssistantHistory).mock.calls.at(-1)?.[1]).toBe(
    'initial-epoch'
  )
})

it.each(['clear', 'reload'] as const)(
  '%s through the highest request workflow discards a late reply and starts the next send with empty history',
  async action => {
    await open()
    let finish!: (
      value: Awaited<ReturnType<typeof commands.assistantModelTurn>>
    ) => void
    vi.mocked(commands.helpCorpus).mockResolvedValue({
      status: 'ok',
      data: HELP_BOOKS.flatMap(book =>
        book.documentIds.map(id => ({
          id,
          path: `${id}.md`,
          markdown: `# ${id}\n\nDocumentation.`,
        }))
      ),
    })
    vi.mocked(commands.beginAssistantRequest).mockImplementation(
      async (_identity, requestId) => ({
        status: 'ok',
        data: {
          requestId,
          model: 'fixture',
          baseUrl: 'https://model.example',
          config: { model: 'fixture', baseUrl: 'https://model.example' },
        },
      })
    )
    vi.mocked(commands.assistantModelTurn)
      .mockResolvedValue({
        status: 'ok',
        data: { text: 'A new answer.', toolCalls: [] },
      })
      .mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve
          })
      )
    useAssistantStore.setState({ configured: true })
    useAssistantStore.getState().setInput('Old question')
    const sending = useAssistantStore.getState().send()
    await vi.waitFor(() => expect(finish).toBeDefined())
    if (action === 'clear') await useAssistantStore.getState().clearHistory()
    else await useAssistantStore.getState().retryHistory()
    finish({ status: 'ok', data: { text: 'Late old reply.', toolCalls: [] } })
    await sending
    expect(useAssistantStore.getState().messages).toEqual([])
    expect(useAssistantStore.getState().input).toBe('Old question')
    useAssistantStore.getState().setInput('New question')
    await useAssistantStore.getState().send()
    await flushAssistantHistory()
    expect(useAssistantStore.getState().messages.at(-1)?.text).toBe(
      'A new answer.'
    )
    expect(
      JSON.stringify(
        vi.mocked(commands.assistantModelTurn).mock.calls.at(-1)?.[1]
      )
    ).not.toContain('Old question')
    expect(
      JSON.stringify(vi.mocked(commands.saveAssistantHistory).mock.calls)
    ).not.toContain('Late old reply.')
  }
)

it('restores records as inert history without resuming a pending request', async () => {
  vi.mocked(commands.loadAssistantHistory).mockResolvedValueOnce({
    status: 'ok',
    data: {
      epoch: 'restored-epoch',
      projectKey: 'a'.repeat(64),
      appVersion: '1.6.5',
      messages: [
        {
          id: 'pending-old',
          role: 'assistant',
          text: 'Partial old response',
          status: 'pending',
          sources: [],
          scope: 'platform',
        },
      ],
    },
  })
  useAssistantStore.getState().syncWorkspace('restored-project')
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().historyState).toBe('ready')
  )
  expect(useAssistantStore.getState().messages).toEqual([
    expect.objectContaining({
      text: 'Partial old response',
      status: 'cancelled',
      appVersion: '1.6.5',
    }),
  ])
  expect(useAssistantStore.getState().historicalMessageIds).toEqual([
    'pending-old',
  ])
  expect(useAssistantStore.getState().historyEpoch).toBe('restored-epoch')
  expect(useAssistantStore.getState().phase).toBe('idle')
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
})

it('blocks sends with a stale history epoch until explicit recovery', async () => {
  await open()
  useAssistantStore.setState({
    configured: true,
    historySaveError: 'staleHistory',
    input: 'Keep this input',
  })
  await useAssistantStore.getState().send()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(useAssistantStore.getState().input).toBe('Keep this input')
})

it.each(['history-first', 'configuration-first'] as const)(
  'finishes configuration and history initialization independently (%s)',
  async order => {
    const prefs = await commands.loadPreferences()
    if (prefs.status !== 'ok') throw new Error('Missing fixture preferences')
    let finishPrefs!: (value: typeof prefs) => void
    let finishHistory!: (
      value: Awaited<ReturnType<typeof commands.loadAssistantHistory>>
    ) => void
    vi.mocked(commands.loadPreferences).mockReturnValueOnce(
      new Promise(resolve => {
        finishPrefs = resolve
      })
    )
    vi.mocked(commands.loadAssistantHistory).mockReturnValueOnce(
      new Promise(resolve => {
        finishHistory = resolve
      })
    )
    useAssistantStore.getState().syncWorkspace('project')
    await vi.waitFor(() =>
      expect(commands.loadAssistantHistory).toHaveBeenCalled()
    )
    const configure = () =>
      finishPrefs({
        status: 'ok',
        data: {
          ...prefs.data,
          modelService: { baseUrl: 'https://model.example', model: 'fixture' },
        },
      })
    const restore = () => finishHistory({ status: 'ok', data: history() })
    if (order === 'history-first') {
      restore()
      await vi.waitFor(() =>
        expect(useAssistantStore.getState().historyState).toBe('ready')
      )
      configure()
    } else {
      configure()
      await vi.waitFor(() =>
        expect(useAssistantStore.getState().configured).toBe(true)
      )
      restore()
    }
    await vi.waitFor(() => {
      expect(useAssistantStore.getState().configured).toBe(true)
      expect(useAssistantStore.getState().historyState).toBe('ready')
    })
  }
)

it('does not restore a late load from another workspace or an earlier opening', async () => {
  let finish!: (
    value: Awaited<ReturnType<typeof commands.loadAssistantHistory>>
  ) => void
  vi.mocked(commands.loadAssistantHistory).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  useAssistantStore.getState().syncWorkspace('project')
  await vi.waitFor(() => expect(finish).toBeDefined())
  useAssistantStore.getState().syncWorkspace('different-project')
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().historyState).toBe('ready')
  )
  useAssistantStore.getState().syncWorkspace('project')
  await vi.waitFor(() =>
    expect(useAssistantStore.getState().historyState).toBe('ready')
  )
  finish({
    status: 'ok',
    data: history([message('Late transcript')], 'late-epoch'),
  })
  await new Promise(resolve => setTimeout(resolve, 0))
  expect(useAssistantStore.getState().messages).toEqual([])
  expect(useAssistantStore.getState().historyEpoch).toBe('initial-epoch')
})

it.each(['clear', 'reload', 'failed-reload'] as const)(
  'keeps a pending configuration read when history %s advances its own generation',
  async action => {
    const prefs = await commands.loadPreferences()
    if (prefs.status !== 'ok') throw new Error('Missing fixture preferences')
    let finish!: (value: typeof prefs) => void
    vi.mocked(commands.loadPreferences).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    if (action === 'failed-reload') {
      vi.mocked(commands.loadAssistantHistory).mockResolvedValueOnce({
        status: 'error',
        error: { type: 'io' },
      })
      useAssistantStore.getState().syncWorkspace('project')
      await vi.waitFor(() =>
        expect(useAssistantStore.getState().historyState).toBe('error')
      )
    } else await open()
    if (action === 'clear') await useAssistantStore.getState().clearHistory()
    else await useAssistantStore.getState().retryHistory()
    finish({
      status: 'ok',
      data: {
        ...prefs.data,
        modelService: { baseUrl: 'https://model.example', model: 'fixture' },
      },
    })
    await vi.waitFor(() =>
      expect(useAssistantStore.getState().configured).toBe(true)
    )
  }
)
