import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { editText, findEditorWithText } from '@/test/text-editor'
import { commands, type ParameterRequest } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useAssistantProposalStore } from '@/store/assistant-proposal-store'
import { useSessionStore } from '@/store/session-store'
import { seedCreationDraft } from '@/test/creation-files'
import { AssistantLiveProposals } from './AssistantLiveProposals'

const source = 'const speed = 2;\nconst title = "Blue";\n'
const request: ParameterRequest = {
  spec: {
    id: 'speed',
    path: 'score.js',
    prefix: 'const speed = ',
    suffix: ';',
    kind: 'number',
    limits: { min: null, max: null, step: null, maxLength: null, options: [] },
    preview: 'unsupported',
  },
  current: 2,
  suggestedMin: 0,
  suggestedMax: 10,
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'p',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [
        {
          path: 'score.js',
          kind: 'text',
          category: 'pages',
          size: source.length,
        },
      ],
    },
  })
  useCreationFilesStore.getState().clear()
  useAssistantProposalStore.getState().clear()
  useSessionStore.setState({ sessionStatus: 'idle' })
  seedCreationDraft('score.js', source, 'v1')
})
it('shares the editor candidate with controls, disables an expression and still applies valid code without a runtime', async () => {
  const candidate = 'const speed = 3;\nconst title = "Blue";\n'
  useAssistantProposalStore.getState().install(
    'p',
    'reply',
    'key',
    [
      {
        id: 'offer',
        path: 'score.js',
        version: 'v1',
        sourceText: source,
        text: candidate,
        parameters: [request],
        binding: {
          parameters: [{ request, value: 3 }],
          contractVersion: null,
          partial: false,
        },
      },
    ],
    vi.fn()
  )
  render(<AssistantLiveProposals messageId="reply" />)
  expect(screen.getByRole('spinbutton', { name: 'speed' })).toHaveValue(3)
  fireEvent.click(screen.getByRole('button', { name: 'Code' }))
  const view = await findEditorWithText(candidate)
  const edited = 'const speed = amount * 2;\nconst title = "Amber";\n'
  vi.mocked(commands.bindCreationParameters).mockResolvedValue({
    status: 'ok',
    data: {
      parameters: [{ request, value: null }],
      partial: true,
      contractVersion: null,
    },
  })
  act(() => editText(view, edited))
  await waitFor(() =>
    expect(useAssistantProposalStore.getState().items.offer?.bindingBusy).toBe(
      false
    )
  )
  fireEvent.click(screen.getByRole('button', { name: 'Parameters' }))
  expect(screen.getByRole('spinbutton', { name: 'speed' })).toBeDisabled()
  expect(useCreationFilesStore.getState().drafts['score.js']?.text).toBe(source)
  vi.mocked(commands.saveCreationFileChange).mockResolvedValue({
    status: 'ok',
    data: {
      id: 'written',
      path: 'score.js',
      beforeText: source,
      afterText: edited,
      beforeVersion: 'v1',
      afterVersion: 'v2',
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Apply this candidate' }))
  await waitFor(() =>
    expect(commands.saveCreationFileChange).toHaveBeenCalledExactlyOnceWith(
      'p',
      'score.js',
      edited,
      'v1'
    )
  )
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.startCreationCheck).not.toHaveBeenCalled()
  expect(commands.assistantModelTurn).not.toHaveBeenCalled()
  expect(screen.getByText(/Actual applied difference/)).toBeInTheDocument()
})
