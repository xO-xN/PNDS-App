import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useAssistantStore } from '@/store/assistant-store'
import { CreationView } from './CreationView'
import { AssistantHistoryControls } from './AssistantHistoryControls'
import i18n from '@/i18n/config'

beforeEach(async () => {
  await i18n.changeLanguage('en')
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    opening: false,
    modePhase: 'idle',
    error: null,
    workspace: {
      project: {
        identity: 'history-ui',
        root: '/history-ui',
        name: 'History project',
        source: 'folder',
      },
      files: [{ path: 'score.js', kind: 'text', category: 'pages', size: 10 }],
    },
  })
  useCreationFilesStore.getState().clear()
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationReadingStore.getState().syncWorkspace('history-ui')
  useAssistantStore.getState().stop()
  await useAssistantStore.getState().retryHistory()
  useAssistantStore.setState({
    owner: 'history-ui',
    input: 'Continue this question',
    messages: [],
    phase: 'idle',
    error: null,
    configured: true,
    historyState: 'ready',
    historyBusy: false,
    historySaving: false,
    historicalMessageIds: [],
    historyError: null,
    historySaveError: null,
    historyProjectKey: 'project-key',
    historyAppVersion: '1.7.0',
    historyEpoch: 'history-initial',
  })
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: 'current disk', version: 'current-v2' },
  })
})

describe('project assistant history (#167)', () => {
  it.each([
    [
      'en',
      'Updating this project’s chat history…',
      'Chat history is saved on this Mac.',
    ],
    ['zh-CN', '正在更新当前工程的聊天记录…', '聊天记录已保存在本机。'],
  ])(
    'keeps one stable saving announcement through streamed checkpoints in %s',
    async (locale, updating, saved) => {
      await i18n.changeLanguage(locale)
      render(<AssistantHistoryControls identity="history-ui" />)
      expect(screen.getByText(saved)).toBeVisible()
      act(() => useAssistantStore.setState({ phase: 'responding' }))
      for (let checkpoint = 0; checkpoint < 3; checkpoint++) {
        let finish!: (
          value: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
        ) => void
        vi.mocked(commands.saveAssistantHistory).mockImplementationOnce(
          () =>
            new Promise(resolve => {
              finish = resolve
            })
        )
        let pending!: Promise<void>
        act(() => {
          pending = useAssistantStore.getState().persistHistory()
        })
        expect(screen.getByText(updating)).toBeVisible()
        await act(async () => {
          await Promise.resolve()
        })
        await act(async () => {
          finish({ status: 'ok', data: null })
          await pending
        })
        expect(screen.getByText(updating)).toBeVisible()
        expect(screen.queryByText(saved)).not.toBeInTheDocument()
      }
      let finish!: (
        value: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
      ) => void
      vi.mocked(commands.saveAssistantHistory).mockImplementationOnce(
        () =>
          new Promise(resolve => {
            finish = resolve
          })
      )
      let pending!: Promise<void>
      act(() => {
        useAssistantStore.setState({ phase: 'idle' })
        pending = useAssistantStore.getState().persistHistory()
      })
      expect(screen.getByText(updating)).toBeVisible()
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        finish({ status: 'ok', data: null })
        await pending
      })
      expect(screen.getByText(saved)).toBeVisible()
    }
  )

  it('requires confirmation before replacing stale in-memory chat with saved history and preserves the input and file draft', async () => {
    useAssistantStore.setState({
      historySaveError: 'staleHistory',
      messages: [
        {
          id: 'memory',
          role: 'assistant',
          text: 'Unsaved in-memory reply',
          status: 'completed',
          scope: 'platform',
          sources: [],
        },
      ],
    })
    vi.mocked(commands.loadAssistantHistory).mockClear()
    const user = userEvent.setup()
    render(<CreationView />)
    await user.click(screen.getByRole('button', { name: 'score.js' }))
    await screen.findByRole('textbox', { name: 'score.js' })
    act(() =>
      useCreationFilesStore.getState().edit('score.js', 'draft survives reload')
    )
    await user.click(screen.getByRole('button', { name: 'Back to discussion' }))
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Retry saving history' })
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Reload saved history' })
    )
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'replaces the messages currently in memory'
    )
    await user.keyboard('{Escape}')
    expect(commands.loadAssistantHistory).not.toHaveBeenCalled()
    expect(screen.getByText('Unsaved in-memory reply')).toBeVisible()
    await user.keyboard('{Enter}{Tab}{Enter}')
    expect(commands.loadAssistantHistory).toHaveBeenCalledWith('history-ui')
    expect(await screen.findByText(/Discuss your musical ideas/)).toBeVisible()
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('Continue this question')
    expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(
      'draft survives reload'
    )
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
  })

  it('keeps a real save failure visible throughout generation and a pending retry', async () => {
    useAssistantStore.setState({ phase: 'responding' })
    render(<AssistantHistoryControls identity="history-ui" />)
    vi.mocked(commands.saveAssistantHistory).mockResolvedValueOnce({
      status: 'error',
      error: { type: 'io' },
    })
    await act(() => useAssistantStore.getState().persistHistory())
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Chat history could not be saved.'
    )
    expect(
      screen.queryByText('Updating this project’s chat history…')
    ).not.toBeInTheDocument()
    expect(
      screen.queryByText('Chat history is saved on this Mac.')
    ).not.toBeInTheDocument()
    let finish!: (
      value: Awaited<ReturnType<typeof commands.saveAssistantHistory>>
    ) => void
    vi.mocked(commands.saveAssistantHistory).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    let pending!: Promise<void>
    act(() => {
      pending = useAssistantStore.getState().persistHistory()
    })
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Chat history could not be saved.'
    )
    expect(
      screen.queryByText('Updating this project’s chat history…')
    ).not.toBeInTheDocument()
    await act(async () => {
      await Promise.resolve()
    })
    await act(async () => {
      finish({ status: 'ok', data: null })
      await pending
    })
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(
      screen.getByText('Updating this project’s chat history…')
    ).toBeVisible()
    act(() => useAssistantStore.setState({ phase: 'idle' }))
    expect(screen.getByText('Chat history is saved on this Mac.')).toBeVisible()
  })

  it('keeps chat visible after a failed clear and retries only through a fresh confirmation', async () => {
    useAssistantStore.setState({
      messages: [
        {
          id: 'keep',
          role: 'assistant',
          text: 'Chat to retain on failure',
          status: 'completed',
          scope: 'platform',
          sources: [],
        },
      ],
    })
    let finish = (
      _: Awaited<ReturnType<typeof commands.clearAssistantHistory>>
    ): void => {
      throw new Error('Deferred clear has not started')
    }
    vi.mocked(commands.clearAssistantHistory).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    const user = userEvent.setup()
    render(<CreationView />)
    await user.click(
      screen.getByRole('button', { name: 'Clear project history' })
    )
    await user.click(screen.getByRole('button', { name: 'Clear this history' }))
    expect(
      screen.getByText('Updating this project’s chat history…')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(
      screen.getByRole('button', { name: 'Clear project history' })
    ).toBeDisabled()
    await act(async () => finish({ status: 'error', error: { type: 'io' } }))
    expect(screen.getByRole('alert')).toHaveTextContent(
      'The history operation failed.'
    )
    expect(screen.getByText('Chat to retain on failure')).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Reload chat history' })
    ).not.toBeInTheDocument()
    await user.click(
      screen.getByRole('button', { name: 'Clear project history' })
    )
    expect(commands.clearAssistantHistory).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Clear this history' }))
    expect(commands.clearAssistantHistory).toHaveBeenCalledTimes(2)
    expect(
      screen.queryByText('Chat to retain on failure')
    ).not.toBeInTheDocument()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
  })

  it.each([
    [
      'en',
      'Chat history could not be saved.',
      'Retry saving history',
      'Chat history is saved on this Mac.',
    ],
    ['zh-CN', '聊天记录未能保存。', '重试保存记录', '聊天记录已保存在本机。'],
  ])(
    'offers a keyboard-operated save retry in %s without retrying a model request',
    async (locale, failure, retry, saved) => {
      await i18n.changeLanguage(locale)
      vi.mocked(commands.saveAssistantHistory).mockResolvedValueOnce({
        status: 'error',
        error: { type: 'io' },
      })
      const user = userEvent.setup()
      render(<CreationView />)
      await act(() => useAssistantStore.getState().persistHistory())
      expect(screen.getByRole('alert')).toHaveTextContent(failure)
      expect(screen.queryByText(saved)).not.toBeInTheDocument()
      screen.getByRole('button', { name: retry }).focus()
      await user.keyboard('{Enter}')
      expect(await screen.findByText(saved)).toBeVisible()
      expect(commands.saveAssistantHistory).toHaveBeenCalledTimes(2)
      expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    }
  )

  it('offers a manual history reload for an unsupported version and keeps Send blocked until recovery', async () => {
    useAssistantStore.setState({
      historyState: 'error',
      historyError: 'unsupportedVersion',
    })
    const user = userEvent.setup()
    render(<CreationView />)
    expect(screen.getByRole('alert')).toHaveTextContent(
      'newer or unsupported history format'
    )
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.click(
      screen.getByRole('button', { name: 'Reload chat history' })
    )
    expect(commands.loadAssistantHistory).toHaveBeenCalledWith('history-ui')
    expect(
      await screen.findByText('Chat history is saved on this Mac.')
    ).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('requires explicit keyboard confirmation to clear this project while preserving the composed question and current file draft', async () => {
    useAssistantStore.setState({
      messages: [
        {
          id: 'old',
          role: 'assistant',
          text: 'Earlier chat',
          status: 'completed',
          scope: 'platform',
          sources: [],
        },
      ],
    })
    const user = userEvent.setup()
    render(<CreationView />)
    await user.click(screen.getByRole('button', { name: 'score.js' }))
    await screen.findByRole('textbox', { name: 'score.js' })
    act(() =>
      useCreationFilesStore.getState().edit('score.js', 'keep this draft')
    )
    await user.click(screen.getByRole('button', { name: 'Back to discussion' }))
    const clear = screen.getByRole('button', { name: 'Clear project history' })
    clear.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('History project')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(commands.clearAssistantHistory).not.toHaveBeenCalled()
    expect(clear).toHaveFocus()
    await user.keyboard('{Enter}{Tab}{Enter}')
    expect(commands.clearAssistantHistory).toHaveBeenCalledWith('history-ui')
    expect(await screen.findByText(/Discuss your musical ideas/)).toBeVisible()
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('Continue this question')
    expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(
      'keep this draft'
    )
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
  })

  it('shows original attachment and proposal snapshots without restoring any consumer actions or replacing the current draft', async () => {
    vi.mocked(commands.loadAssistantHistory).mockResolvedValueOnce({
      status: 'ok',
      data: {
        epoch: 'restored',
        projectKey: 'project-key',
        appVersion: '1.7.0',
        messages: [
          {
            id: 'restored-reply',
            role: 'assistant',
            text: 'Earlier advice',
            status: 'completed',
            scope: 'project',
            sources: [],
            appVersion: '1.6.9',
            attachments: [
              {
                id: 'attachment',
                projectKey: 'project-key',
                path: 'deleted.js',
                startLine: 3,
                endLine: 7,
                source: 'draft',
                version: 'draft-v1',
                candidateRevision: null,
                text: 'exact previous unsaved attachment',
              },
            ],
            proposals: [
              {
                id: 'proposal',
                projectKey: 'project-key',
                path: 'score.js',
                sourceVersion: 'old-v1',
                candidateRevision: 4,
                text: 'old proposal code',
                preview: 'historical',
                pendingRefresh: true,
                appliedDiff: {
                  before: 'earlier before',
                  after: 'earlier after',
                },
              },
            ],
          },
        ],
      },
    })
    const user = userEvent.setup()
    render(
      <CreationView
        renderAssistantCards={() => <button>Execute restored proposal</button>}
      />
    )
    await act(() => useAssistantStore.getState().retryHistory())
    expect(screen.getByText('Recorded with PNDS App 1.6.9')).toBeVisible()
    expect(screen.getByText('exact previous unsaved attachment')).toBeVisible()
    expect(screen.getByText('Draft snapshot')).toBeVisible()
    expect(screen.getByText(/deleted.js.*3.*7/)).toBeVisible()
    expect(screen.getByText(/draft-v1/)).toBeVisible()
    expect(screen.getByText('old proposal code')).toBeVisible()
    expect(screen.getByText(/old-v1.*4/)).toBeVisible()
    expect(
      screen.queryByRole('button', { name: 'Execute restored proposal' })
    ).not.toBeInTheDocument()
    expect(
      screen.getByText(/Historical snapshots do not restore sending/)
    ).toBeVisible()
    await user.click(screen.getByText('Actual applied difference'))
    expect(screen.getByLabelText('After application')).toHaveTextContent(
      'earlier after'
    )
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'score.js' }))
    expect(
      await screen.findByRole('textbox', { name: 'score.js' })
    ).toHaveTextContent('current disk')
    act(() =>
      useCreationFilesStore.getState().edit('score.js', 'new local draft')
    )
    await user.click(screen.getByRole('button', { name: 'Back to discussion' }))
    expect(screen.getByText('old proposal code')).toBeVisible()
    expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(
      'new local draft'
    )
    expect(commands.readCreationFile).not.toHaveBeenCalledWith(
      'history-ui',
      'deleted.js'
    )
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  })

  it('blocks new sends during restoration without blocking local file access or input editing', async () => {
    useAssistantStore.setState({ historyState: 'loading' })
    const user = userEvent.setup()
    render(<CreationView />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Loading this project’s chat history'
    )
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.type(
      screen.getByRole('textbox', { name: 'Ask the assistant' }),
      ' while loading'
    )
    await user.keyboard('{Meta>}{Enter}{/Meta}')
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'score.js' }))
    expect(
      await screen.findByRole('textbox', { name: 'score.js' })
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Back to discussion' }))
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('Continue this question while loading')
    act(() => useAssistantStore.setState({ historyState: 'ready' }))
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })
})
