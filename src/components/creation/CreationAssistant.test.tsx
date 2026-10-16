import { beforeEach, describe, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { flushSync } from 'react-dom'
import { TextBuffer } from '@/lib/text-buffer'
import { editText } from '@/test/text-editor'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { CreationView } from './CreationView'
import { useAssistantStore } from '@/store/assistant-store'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import { CreationAssistant } from './CreationAssistant'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useSettingsStore } from '@/store/settings-store'
import {
  AssistantProposalCard,
  type AssistantProposal,
} from './AssistantProposalCard'

beforeEach(async () => {
  vi.clearAllMocks()
  useAssistantProjectStore.getState().syncWorkspace(null)
  useAssistantProjectStore.getState().syncWorkspace('assistant-test')
  useCreationStore.setState({
    active: true,
    opening: false,
    modePhase: 'idle',
    error: null,
    workspace: {
      project: {
        identity: 'assistant-test',
        root: '/draft',
        name: 'Draft',
        source: 'folder',
      },
      files: [{ path: 'score.js', kind: 'text', category: 'pages', size: 10 }],
    },
  })
  useCreationFilesStore.getState().clear()
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationReadingStore.getState().syncWorkspace('assistant-test')
  useAssistantStore.getState().stop()
  await useAssistantStore.getState().retryHistory()
  useAssistantStore.setState({
    owner: 'assistant-test',
    input: '',
    messages: [],
    phase: 'idle',
    error: null,
    configured: false,
  })
  vi.mocked(commands.readCreationFile).mockResolvedValue({
    status: 'ok',
    data: { kind: 'text', text: 'const saved = 1', version: 'v1' },
  })
})

describe('creation discussion reading (#166)', () => {
  it('opens whole-project scope only on explicit action and Escape preserves the composer (#170)', async () => {
    const user = userEvent.setup()
    useAssistantStore.setState({
      configured: true,
      modelConfig: {
        model: 'whole-model',
        baseUrl: 'https://model.example/v1',
      },
      input: 'Keep original input',
    })
    vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
      status: 'ok',
      data: { files: [], fingerprint: 'empty' },
    })
    render(<CreationAssistant identity="assistant-test" />)
    expect(
      screen.queryByRole('dialog', { name: 'Confirm whole-project reading' })
    ).not.toBeInTheDocument()
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Read whole project' }))
    expect(
      await screen.findByRole('dialog', {
        name: 'Confirm whole-project reading',
      })
    ).toHaveTextContent('whole-model')
    await vi.waitFor(() =>
      expect(useAssistantProjectStore.getState().planning).toBe(false)
    )
    expect(screen.getByRole('dialog')).toHaveTextContent('not provider usage')
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('Keep original input')
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  })
  it('captures a selected pending suggestion with proposal identity and candidate revision (#225)', async () => {
    const buffer = new TextBuffer(
      'const label = "new";\n// not selected',
      'score.js'
    )
    buffer.select(0, 20)
    vi.mocked(commands.assistantProjectRead).mockResolvedValue({
      status: 'ok',
      data: {
        path: 'score.js',
        version: 'v1',
        text: 'saved',
        offset: 0,
        endOffset: 5,
        totalCharacters: 5,
        nextOffset: null,
        startLine: 1,
        endLine: 1,
      },
    })
    const onApply = vi.fn()
    const onPreview = vi.fn()
    render(
      <AssistantProposalCard
        proposal={{
          id: 'suggestion-1',
          messageId: 'reply',
          identity: 'assistant-test',
          source: { path: 'score.js', version: 'v1' },
          candidate: { revision: 7, text: buffer.text },
          preview: 'none',
          pendingRefresh: false,
          appliedDiff: null,
        }}
        parameters={null}
        buffer={buffer}
        onCodeChange={() => undefined}
        onApply={onApply}
        onPreview={onPreview}
      />
    )
    fireEvent.click(screen.getByRole('button', { name: 'Code' }))
    fireEvent.click(screen.getByRole('button', { name: 'Discuss selection' }))
    await vi.waitFor(() =>
      expect(useAssistantProjectStore.getState().attachments).toHaveLength(1)
    )
    expect(
      useAssistantProjectStore.getState().attachments[0]?.snapshot
    ).toMatchObject({
      source: 'proposal',
      proposalId: 'suggestion-1',
      candidateRevision: 7,
      sourceVersion: 'v1',
      text: 'const label = "new";',
    })
    expect(onApply).not.toHaveBeenCalled()
    expect(onPreview).not.toHaveBeenCalled()
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  })
  it('shows project, service and scope before sending and keeps the question on Escape (#168)', async () => {
    const user = userEvent.setup()
    useAssistantProjectStore.getState().syncWorkspace('assistant-test')
    useAssistantProjectStore.getState().setReading(false)
    useAssistantStore.setState({
      configured: true,
      modelConfig: { model: 'test-model', baseUrl: 'https://model.example/v1' },
    })
    vi.mocked(commands.assistantProjectInventory).mockResolvedValue({
      status: 'ok',
      data: {
        files: [
          { path: 'score.js', bytes: 10, version: 'v1', reason: null },
          { path: '.env', bytes: 0, version: null, reason: 'sensitive' },
        ],
        fingerprint: 'scope',
      },
    })
    render(<CreationAssistant identity="assistant-test" />)
    await user.click(
      screen.getByRole('checkbox', { name: 'Read current project' })
    )
    await user.type(
      screen.getByRole('textbox', { name: 'Ask the assistant' }),
      'Explain the saved score{Enter}'
    )
    expect(
      await screen.findByRole('dialog', { name: 'Send project content' })
    ).toHaveTextContent('test-model')
    expect(screen.getByRole('dialog')).toHaveTextContent(
      'Sensitive configuration'
    )
    expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
    await user.keyboard('{Escape}')
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('Explain the saved score')
    useAssistantProjectStore.getState().setReading(false)
  })
  it('sends with Enter and inserts a line break with Shift+Enter', async () => {
    useAssistantStore.setState({ configured: true })
    const original = useAssistantStore.getState().send
    const send = vi.fn().mockResolvedValue(undefined)
    useAssistantStore.setState({ send })
    try {
      const user = userEvent.setup()
      render(<CreationAssistant identity="assistant-test" />)
      const input = screen.getByRole('textbox', { name: 'Ask the assistant' })
      await user.type(input, 'First line{Shift>}{Enter}{/Shift}Second line')
      expect(input).toHaveValue('First line\nSecond line')
      expect(send).not.toHaveBeenCalled()
      await user.keyboard('{Enter}')
      expect(send).toHaveBeenCalledOnce()
      expect(input).toHaveValue('First line\nSecond line')
    } finally {
      useAssistantStore.setState({ send: original })
    }
  })

  it.each([{ isComposing: true }, { keyCode: 229 }])(
    'keeps IME confirmation Enter from sending (%o)',
    nativeState => {
      useAssistantStore.setState({ configured: true, input: '输入法选词' })
      const original = useAssistantStore.getState().send
      const send = vi.fn().mockResolvedValue(undefined)
      useAssistantStore.setState({ send })
      try {
        render(<CreationAssistant identity="assistant-test" />)
        fireEvent.keyDown(
          screen.getByRole('textbox', { name: 'Ask the assistant' }),
          { key: 'Enter', ...nativeState }
        )
        expect(send).not.toHaveBeenCalled()
      } finally {
        useAssistantStore.setState({ send: original })
      }
    }
  )

  it('switches chats and offers a historical question as an editable new-chat draft', async () => {
    const user = userEvent.setup()
    useAssistantStore.setState({
      messages: [
        {
          id: 'question',
          role: 'user',
          text: 'Original question',
          scope: 'platform',
          status: 'completed',
          sources: [],
        },
      ],
      configured: true,
    })
    render(<CreationAssistant identity="assistant-test" />)
    await user.click(screen.getByRole('button', { name: 'Edit and resend' }))
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('Original question')
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveFocus()
    expect(
      screen.getByRole('button', { name: 'Send as new chat' })
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Cancel editing' }))
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('')
    await user.click(screen.getByRole('button', { name: 'New chat' }))
    expect(screen.queryByText('Original question')).not.toBeInTheDocument()
    await user.click(screen.getByRole('combobox', { name: 'Chats' }))
    await user.click(
      screen.getByRole('option', { name: /1 · Original question/ })
    )
    expect(screen.getByText('Original question')).toBeVisible()
  })

  it.each(['bundle', 'utility', 'readOnlyFolder'] as const)(
    'keeps the readonly file reader available without an assistant for %s projects',
    async source => {
      const workspace = useCreationStore.getState().workspace
      if (!workspace) throw new Error('Expected fixture workspace')
      useCreationStore.setState({
        workspace: {
          ...workspace,
          project: { ...workspace.project, source },
        },
      })
      const user = userEvent.setup()
      render(<CreationView />)
      expect(
        screen.queryByRole('textbox', { name: 'Ask the assistant' })
      ).not.toBeInTheDocument()
      expect(
        screen.queryByRole('navigation', { name: 'Reading views' })
      ).not.toBeInTheDocument()
      await user.click(screen.getByRole('button', { name: 'score.js' }))
      const reader = await screen.findByRole('textbox', { name: 'score.js' })
      expect(reader).toBeVisible()
      expect(reader).toHaveTextContent('const saved = 1')
      expect(reader).toHaveAttribute('aria-readonly', 'true')
      expect(
        screen.queryByRole('button', { name: 'Send' })
      ).not.toBeInTheDocument()
    }
  )

  it('offers a configuration reload and Settings route after an unknown configuration failure', async () => {
    useAssistantStore.setState({ configured: null, error: 'requestFailed' })
    const user = userEvent.setup()
    render(<CreationView />)
    expect(
      screen.getByRole('button', { name: 'Configure model service' })
    ).toBeVisible()
    expect(
      screen.getByRole('button', { name: 'Retry manually' })
    ).toBeDisabled()
    await user.click(
      screen.getByRole('button', { name: 'Reload configuration' })
    )
    expect(
      await screen.findByText(
        'Configure a model service to start a discussion. File editing and manual testing remain available.'
      )
    ).toBeVisible()
  })

  it('keeps local file access available when unconfigured and opens the actual model settings route', async () => {
    const user = userEvent.setup()
    render(<CreationView />)
    await user.click(
      await screen.findByRole('button', { name: 'Configure model service' })
    )
    expect(useSettingsStore.getState().focusSection).toBe('modelService')
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'score.js' }))
    expect(
      await screen.findByRole('textbox', { name: 'score.js' })
    ).toBeVisible()
    useSettingsStore.getState().closeSettings()
  })

  it('renders model content without executable HTML, remote images or model-authored navigation', () => {
    useAssistantStore.setState({
      messages: [
        {
          id: 'safe-message',
          role: 'assistant',
          text: '<script>window.evil = true</script>\n[run](javascript:alert(1))\n![tracking](https://tracking.example/secret)\n[external](https://example.com)',
          status: 'completed',
          sources: [],
          scope: 'platform',
        },
      ],
    })
    const { container } = render(<CreationView />)
    const article = container.querySelector('[data-message-id="safe-message"]')
    expect(article).not.toBeNull()
    expect(article?.querySelector('script,iframe,img,a')).toBeNull()
    expect(article).toHaveTextContent('tracking')
    expect(article).toHaveTextContent('external')
    expect(article).toHaveTextContent(
      'No local documentation source was consulted'
    )
  })

  it('announces reading state, prevents duplicate sending, and retains input when stopped', async () => {
    useAssistantStore.setState({
      input: 'How does PNDS work?',
      configured: true,
      phase: 'reading',
      messages: [
        {
          id: 'pending',
          role: 'assistant',
          text: 'Partial answer',
          status: 'pending',
          sources: [],
          scope: 'platform',
        },
      ],
    })
    const user = userEvent.setup()
    render(<CreationView />)
    expect(screen.getByRole('status')).toHaveTextContent(
      'Reading installed PNDS help'
    )
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'Stop' }))
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('How does PNDS work?')
    expect(screen.getByText('Partial answer')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
  })

  it.each(
    (['reading', 'responding'] as const).flatMap(phase =>
      ['click', 'Enter', 'Space'].map(
        activation => [phase, activation] as const
      )
    )
  )(
    'does not submit the %s form when stopping with %s commits idle state before the default action',
    async (phase, activation) => {
      useAssistantStore.setState({
        configured: true,
        historyState: 'ready',
        historyBusy: false,
        input: 'Keep this question',
        phase,
        messages: [],
      })
      render(<CreationAssistant identity="assistant-test" />)
      const original = useAssistantStore.getState()
      const send = vi.fn().mockResolvedValue(undefined)
      useAssistantStore.setState({
        send,
        stop: () => flushSync(original.stop),
      })
      try {
        const user = userEvent.setup()
        const stop = screen.getByRole('button', { name: 'Stop' })
        if (activation === 'click') await user.click(stop)
        else {
          stop.focus()
          await user.keyboard(activation === 'Enter' ? '{Enter}' : ' ')
        }
        expect(send).not.toHaveBeenCalled()
        expect(useAssistantStore.getState().input).toBe('Keep this question')
        expect(screen.getByRole('button', { name: 'Send' })).toBeEnabled()
      } finally {
        useAssistantStore.setState({ send: original.send, stop: original.stop })
      }
    }
  )

  it('groups consulted documents while waiting and distinguishes an incomplete reply after timeout', async () => {
    useAssistantStore.setState({
      input: 'Can a declaration prove hardware acceptance?',
      configured: true,
      phase: 'responding',
      messages: [
        {
          id: 'waiting-for-answer',
          role: 'assistant',
          text: '',
          status: 'pending',
          sources: [
            {
              docId: 'reference-manifest',
              sectionId: 'manifest-fields',
              title: 'Manifest · Fields',
              locale: 'en',
            },
          ],
          scope: 'platform',
        },
      ],
    })
    const user = userEvent.setup()
    render(<CreationView />)
    expect(screen.getByText('Consulted documents (1)')).toBeVisible()
    expect(screen.getByText('Waiting for the model reply…')).toBeVisible()
    const source = screen.getByText('Manifest · Fields')
    expect(source).not.toBeVisible()
    await user.click(screen.getByText('Consulted documents (1)'))
    expect(source).toBeVisible()
    act(() => {
      useAssistantStore.setState(state => ({
        phase: 'idle',
        error: 'timeout',
        messages: state.messages.map(message => ({
          ...message,
          status: 'failed',
          error: 'timeout',
        })),
      }))
    })
    expect(
      screen.getByText(
        'Reply incomplete. These documents were consulted before it stopped.'
      )
    ).toBeVisible()
    expect(source).toBeVisible()
    expect(screen.getByRole('button', { name: 'Retry manually' })).toBeEnabled()
  })

  it('hosts a controlled inline proposal and reading extension while preserving candidate, parameter and file drafts separately', async () => {
    useAssistantStore.setState({
      messages: [
        {
          id: 'reply',
          role: 'assistant',
          text: 'A proposed change',
          status: 'completed',
          sources: [],
          scope: 'platform',
        },
      ],
    })
    const user = userEvent.setup()
    render(
      <CreationView
        renderAssistantCards={message =>
          message.id === 'reply' ? <ControlledProposal /> : null
        }
      />
    )
    await user.clear(screen.getByLabelText('Test parameter'))
    await user.type(screen.getByLabelText('Test parameter'), '2')
    await user.click(screen.getByRole('button', { name: 'Code' }))
    const code = screen.getByRole('textbox', { name: 'score.js' })
    editText(code, 'candidate code')
    await user.click(
      screen.getByRole('button', { name: 'Preview temporarily' })
    )
    expect(
      screen.getByText('Temporary preview only; not saved or checked.')
    ).toBeVisible()
    await user.click(
      screen.getByRole('button', { name: 'Apply this candidate' })
    )
    await user.click(screen.getByText('Actual applied difference'))
    expect(screen.getByLabelText('After application')).toHaveTextContent(
      'candidate code'
    )
    editText(code, 'new unapplied code')
    expect(screen.getByLabelText('After application')).toHaveTextContent(
      'candidate code'
    )
    await user.click(screen.getByRole('button', { name: 'Open current file' }))
    expect(
      await screen.findByRole('textbox', { name: 'score.js' })
    ).toBeVisible()
    act(() =>
      useCreationFilesStore
        .getState()
        .edit('score.js', 'independent file draft')
    )
    await user.click(screen.getByRole('button', { name: 'Back to discussion' }))
    expect(screen.getByRole('textbox', { name: 'score.js' })).toHaveTextContent(
      'new unapplied code'
    )
    expect(document.querySelector('[data-message-id="reply"]')).toHaveFocus()
    await user.click(screen.getByRole('button', { name: 'Parameters' }))
    expect(screen.getByLabelText('Test parameter')).toHaveValue('2')
    await user.click(
      screen.getByRole('button', { name: 'Open controlled reading' })
    )
    expect(
      screen.getByRole('textbox', { name: 'Comparison note' })
    ).toBeVisible()
    await user.type(
      screen.getByRole('textbox', { name: 'Comparison note' }),
      ' retained'
    )
    await user.click(screen.getByRole('button', { name: 'Back to discussion' }))
    expect(screen.getByText('A proposed change')).toBeVisible()
    expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(
      'independent file draft'
    )
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
  })

  it('starts in discussion and preserves the composed question across opening the current file twice', async () => {
    const user = userEvent.setup()
    render(<CreationView />)
    const input = screen.getByRole('textbox', { name: 'Ask the assistant' })
    await user.type(input, 'How do audio buses work?')
    await user.click(screen.getByRole('button', { name: 'score.js' }))
    expect(
      await screen.findByRole('textbox', { name: 'score.js' })
    ).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Back to discussion' }))
    expect(
      screen.getByRole('textbox', { name: 'Ask the assistant' })
    ).toHaveValue('How do audio buses work?')
    await user.click(screen.getByRole('button', { name: 'score.js' }))
    expect(screen.getByRole('textbox', { name: 'score.js' })).toBeVisible()
  })
})

function ControlledProposal() {
  const [buffer] = useState(() => new TextBuffer('candidate', 'score.js'))
  const [parameter, setParameter] = useState('1')
  const [proposal, setProposal] = useState<AssistantProposal>({
    id: 'proposal',
    messageId: 'reply',
    identity: 'assistant-test',
    source: { path: 'score.js', version: 'v1' },
    candidate: { revision: 1, text: 'candidate' },
    preview: 'none',
    pendingRefresh: false,
    appliedDiff: null,
  })
  return (
    <AssistantProposalCard
      proposal={proposal}
      buffer={buffer}
      parameters={
        <>
          <label>
            Test parameter
            <input
              value={parameter}
              onChange={event => setParameter(event.target.value)}
            />
          </label>
          <button
            onClick={() =>
              useCreationReadingStore.getState().showExtension(
                {
                  id: 'controlled',
                  title: 'Controlled reading',
                  content: (
                    <label>
                      Comparison note
                      <input defaultValue="note" />
                    </label>
                  ),
                },
                'reply'
              )
            }
          >
            Open controlled reading
          </button>
        </>
      }
      onCodeChange={text =>
        setProposal(current => ({
          ...current,
          candidate: { revision: current.candidate.revision + 1, text },
          preview: current.preview === 'none' ? 'none' : 'stale',
        }))
      }
      onPreview={() =>
        setProposal(current => ({ ...current, preview: 'temporary' }))
      }
      onApply={() =>
        setProposal(current => ({
          ...current,
          appliedDiff: { before: 'original', after: current.candidate.text },
          pendingRefresh: true,
        }))
      }
    />
  )
}
