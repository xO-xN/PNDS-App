import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, within } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useAssistantStore } from '@/store/assistant-store'
import { CreationView } from './CreationView'
import { AssistantHistoryControls } from './AssistantHistoryControls'
import { AssistantChats } from './AssistantChats'
import { AssistantTasks } from './AssistantTasks'
import i18n from '@/i18n/config'

async function openClearHistory(user: ReturnType<typeof userEvent.setup>) {
  if (!screen.queryByRole('dialog', { name: 'Chats' }))
    await user.click(screen.getByRole('button', { name: 'Chats' }))
  await user.click(
    within(screen.getByRole('dialog', { name: 'Chats' })).getByRole('button', {
      name: 'Clear project history',
    })
  )
}

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
    activeConversationId: null,
    conversationDrafts: {},
    editing: null,
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
  it('keeps restored provider reasoning out of the answer and collapsed work log', async () => {
    useAssistantStore.setState({
      messages: [
        {
          id: 'reasoning-reply',
          role: 'assistant',
          text: 'Saved and checked.',
          reasoningContent: 'private provider reasoning',
          activity: ['Checked the saved files.'],
          status: 'completed',
          scope: 'project',
          sources: [],
        },
      ],
    })
    const user = userEvent.setup()
    render(<CreationView />)
    expect(screen.getByText('Saved and checked.')).toBeVisible()
    expect(
      screen.queryByText('private provider reasoning')
    ).not.toBeInTheDocument()
    await user.click(screen.getByLabelText('Expand work steps'))
    expect(screen.getByText('Checked the saved files.')).toBeVisible()
    expect(
      screen.queryByText('private provider reasoning')
    ).not.toBeInTheDocument()
  })

  it('keeps recovered task undo available in its standalone component', async () => {
    vi.mocked(commands.listCreationAssistantTasks).mockResolvedValueOnce({
      status: 'ok',
      data: [
        {
          id: 'recovered-task',
          mode: 'edit',
          files: [{ path: 'score.js', created: false, undone: false }],
        },
      ],
    })
    render(<AssistantTasks identity="history-ui" />)
    expect(
      await screen.findByRole('button', { name: 'Undo score.js' })
    ).toBeEnabled()
    expect(screen.getByRole('button', { name: 'Undo task' })).toBeEnabled()
    expect(commands.undoCreationAssistantTask).not.toHaveBeenCalled()
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  })

  it('creates a chat from the header and keeps deletion inside chat history', async () => {
    useAssistantStore.setState({
      messages: [
        {
          id: 'existing',
          role: 'user',
          text: 'Existing question',
          status: 'completed',
          scope: 'platform',
          sources: [],
        },
      ],
    })
    const user = userEvent.setup()
    render(
      <AssistantHistoryControls identity="history-ui">
        <AssistantChats identity="history-ui" />
      </AssistantHistoryControls>
    )
    const create = screen.getByRole('button', { name: 'New chat' })
    expect(create).toBeEnabled()
    expect(
      screen.queryByRole('button', { name: 'Conversation options' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: /Delete chat/ })
    ).not.toBeInTheDocument()
    await user.click(create)
    expect(useAssistantStore.getState().activeConversationId).not.toBeNull()
    expect(useAssistantStore.getState().messages).toHaveLength(2)
    expect(useAssistantStore.getState().input).toBe('Continue this question')
    expect(
      useAssistantStore.getState().conversationDrafts.original?.input
    ).toBe('Continue this question')
    await user.click(screen.getByRole('button', { name: 'Chats' }))
    const history = within(screen.getByRole('dialog', { name: 'Chats' }))
    expect(
      history.getByRole('button', { name: 'Delete chat Existing question' })
    ).toBeEnabled()
    expect(
      history.queryByRole('button', { name: 'Clear project history' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Existing question' }))
    expect(useAssistantStore.getState().activeConversationId).toBeNull()
    expect(useAssistantStore.getState().input).toBe('Continue this question')
    expect(commands.assistantProjectOverview).not.toHaveBeenCalled()
    expect(commands.listCreationAssistantTasks).not.toHaveBeenCalled()
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  })

  it.each([
    ['loading history', { historyState: 'loading' }],
    ['failed history', { historyState: 'error' }],
    ['busy history', { historyBusy: true }],
    ['stale history', { historySaveError: 'staleHistory' }],
    ['full history', { historySaveError: 'tooLarge' }],
    ['unsaved history', { historySaveError: 'io' }],
    ['running request', { phase: 'responding' }],
  ] as const)('keeps New chat disabled during %s', async (_, state) => {
    useAssistantStore.setState(state)
    const user = userEvent.setup()
    render(<AssistantChats identity="history-ui" />)
    const item = screen.getByRole('button', { name: 'New chat' })
    expect(item).toBeDisabled()
    await user.click(item)
    expect(useAssistantStore.getState().activeConversationId).toBeNull()
    expect(useAssistantStore.getState().messages).toHaveLength(0)
  })

  it('keeps a full transcript visible, blocks sending, and leaves chat cleanup available', async () => {
    useAssistantStore.setState({
      historySaveError: 'tooLarge',
      messages: [
        {
          id: 'unsaved-reply',
          role: 'assistant',
          text: 'Retained unsaved reply',
          status: 'completed',
          sources: [],
          scope: 'platform',
        },
      ],
    })
    const user = userEvent.setup()
    render(<CreationView />)
    expect(screen.getByText('Retained unsaved reply')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    expect(
      screen.queryByRole('button', { name: 'Retry saving history' })
    ).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Chats' }))
    expect(screen.getByRole('button', { name: /Delete chat/ })).toBeEnabled()
  })

  it('refuses a new chat after the workspace owner changes', async () => {
    const user = userEvent.setup()
    render(<AssistantChats identity="history-ui" />)
    act(() => useAssistantStore.setState({ owner: 'replacement-project' }))
    const item = screen.getByRole('button', { name: 'New chat' })
    expect(item).toBeDisabled()
    await user.click(item)
    expect(useAssistantStore.getState().messages).toHaveLength(0)
    expect(useAssistantStore.getState().activeConversationId).toBeNull()
  })

  it.each([
    [
      'en',
      'Updating this project’s chat history…',
      'Chat history is saved in the project folder.',
    ],
    ['zh-CN', '正在更新当前工程的聊天记录…', '聊天记录已保存在工程目录。'],
  ])(
    'keeps one stable saving announcement through streamed checkpoints in %s',
    async (locale, updating, saved) => {
      await i18n.changeLanguage(locale)
      render(<AssistantHistoryControls identity="history-ui" />)
      expect(screen.getByRole('status', { name: saved })).toHaveClass('sr-only')
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
        expect(screen.getByRole('status', { name: updating })).toHaveClass(
          'sr-only'
        )
        await act(async () => {
          await Promise.resolve()
        })
        await act(async () => {
          finish({ status: 'ok', data: null })
          await pending
        })
        expect(screen.getByRole('status', { name: updating })).toHaveClass(
          'sr-only'
        )
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
      expect(screen.getByRole('status', { name: updating })).toHaveClass(
        'sr-only'
      )
      await act(async () => {
        await Promise.resolve()
      })
      await act(async () => {
        finish({ status: 'ok', data: null })
        await pending
      })
      expect(screen.getByRole('status', { name: saved })).toHaveClass('sr-only')
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
    await user.click(screen.getByRole('treeitem', { name: 'score.js' }))
    await screen.findByRole('textbox', { name: 'score.js' })
    act(() =>
      useCreationFilesStore.getState().edit('score.js', 'draft survives reload')
    )
    await user.click(
      screen.getByRole('button', { name: 'PNDS creation assistant' })
    )
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
    expect(await screen.findByText(i18n.t('assistant.welcome'))).toBeVisible()
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
      screen.queryByText('Chat history is saved in the project folder.')
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
      screen.getByRole('status', {
        name: 'Updating this project’s chat history…',
      })
    ).toHaveClass('sr-only')
    act(() => useAssistantStore.setState({ phase: 'idle' }))
    expect(
      screen.getByText('Chat history is saved in the project folder.')
    ).toBeVisible()
  })

  it('keeps history after a failed reset and retries only through a fresh confirmation', async () => {
    useAssistantStore.setState({
      historyState: 'error',
      historyError: 'invalidFormat',
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
    await openClearHistory(user)
    await user.click(screen.getByRole('button', { name: 'Clear this history' }))
    expect(
      within(screen.getByRole('dialog', { name: 'Chats' })).getByRole(
        'button',
        {
          name: 'Clear project history',
        }
      )
    ).toBeDisabled()
    await act(async () => finish({ status: 'error', error: { type: 'io' } }))
    expect(
      screen.getByRole('dialog', { name: 'Chats' })
    ).toHaveAccessibleDescription(/Check available disk space/)
    expect(useAssistantStore.getState().messages[0]?.text).toBe(
      'Chat to retain on failure'
    )
    await openClearHistory(user)
    expect(commands.clearAssistantHistory).toHaveBeenCalledTimes(1)
    await user.click(screen.getByRole('button', { name: 'Clear this history' }))
    expect(commands.clearAssistantHistory).toHaveBeenCalledTimes(2)
    expect(useAssistantStore.getState().messages).toHaveLength(0)
    expect(useAssistantStore.getState().historyState).toBe('ready')
  })

  it.each([
    [
      'en',
      'Chat history could not be saved.',
      'Retry saving history',
      'Chat history is saved in the project folder.',
    ],
    [
      'zh-CN',
      '聊天记录未能保存。',
      '重试保存记录',
      '聊天记录已保存在工程目录。',
    ],
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
      expect(await screen.findByRole('status', { name: saved })).toHaveClass(
        'sr-only'
      )
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
      await screen.findByRole('status', {
        name: 'Chat history is saved in the project folder.',
      })
    ).toHaveClass('sr-only')
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it('requires explicit keyboard confirmation to clear this project while preserving the composed question and current file draft', async () => {
    useAssistantStore.setState({
      historyState: 'error',
      historyError: 'invalidFormat',
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
    await user.click(screen.getByRole('treeitem', { name: 'score.js' }))
    await screen.findByRole('textbox', { name: 'score.js' })
    act(() =>
      useCreationFilesStore.getState().edit('score.js', 'keep this draft')
    )
    await user.click(
      screen.getByRole('button', { name: 'PNDS creation assistant' })
    )
    const chats = screen.getByRole('button', { name: 'Chats' })
    chats.focus()
    await user.keyboard('{Enter}')
    const clear = within(
      screen.getByRole('dialog', { name: 'Chats' })
    ).getByRole('button', { name: 'Clear project history' })
    clear.focus()
    await user.keyboard('{Enter}')
    expect(screen.getByRole('alertdialog')).toHaveTextContent('History project')
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Escape}')
    expect(commands.clearAssistantHistory).not.toHaveBeenCalled()
    expect(clear).toHaveFocus()
    await user.keyboard('{Enter}')
    expect(await screen.findByRole('alertdialog')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus()
    await user.keyboard('{Tab}{Enter}')
    expect(commands.clearAssistantHistory).toHaveBeenCalledWith('history-ui')
    await user.keyboard('{Escape}')
    expect(await screen.findByText(i18n.t('assistant.welcome'))).toBeVisible()
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
    await user.click(screen.getByRole('treeitem', { name: 'score.js' }))
    expect(
      await screen.findByRole('textbox', { name: 'score.js' })
    ).toHaveTextContent('current disk')
    act(() =>
      useCreationFilesStore.getState().edit('score.js', 'new local draft')
    )
    await user.click(
      screen.getByRole('button', { name: 'PNDS creation assistant' })
    )
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
    await user.click(screen.getByRole('treeitem', { name: 'score.js' }))
    expect(
      await screen.findByRole('textbox', { name: 'score.js' })
    ).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'PNDS creation assistant' })
    )
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('Continue this question while loading')
    act(() => useAssistantStore.setState({ historyState: 'ready' }))
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })
})
