import { beforeEach, expect, it, vi } from 'vitest'
import { render, screen, fireEvent } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { CreationGitRecord } from './CreationGitRecord'

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: {
      project: {
        identity: 'score',
        name: 'Score',
        root: '/score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  vi.mocked(commands.previewCreationGitRecord).mockResolvedValue({
    status: 'ok',
    data: {
      token: 'p1',
      initial: false,
      head: 'head',
      branch: 'main',
      name: 'Creator',
      email: 'c@local',
      files: [
        {
          path: 'server.js',
          size: 15,
          status: 'modified',
          defaultSelected: true,
          exclusion: null,
          staged: false,
        },
        {
          path: 'other.js',
          size: 9,
          status: 'modified',
          defaultSelected: false,
          exclusion: null,
          staged: true,
        },
      ],
    },
  })
})
it('shows saved differences and refuses external staged selection without touching drafts', async () => {
  vi.mocked(commands.readCreationGitDiff).mockResolvedValue({
    status: 'ok',
    data: { state: 'text', text: '-base\n+saved', detail: null },
  })
  render(
    <CreationGitRecord identity="score" onRecorded={vi.fn()} onBack={vi.fn()} />
  )
  await screen.findByRole('textbox', { name: 'Version author name' })
  expect(screen.getByRole('checkbox', { name: /other.js/ })).toBeDisabled()
  fireEvent.click(
    screen.getByRole('button', { name: 'server.js — View saved difference' })
  )
  await screen.findByText('-base +saved', { exact: false })
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})
it('keeps the user message after a refused confirmation and requires a fresh preview', async () => {
  vi.mocked(commands.confirmCreationGitRecord).mockResolvedValue({
    status: 'error',
    error: { code: 'versionConflict', detail: 'Disk changed; preview again' },
  })
  render(
    <CreationGitRecord identity="score" onRecorded={vi.fn()} onBack={vi.fn()} />
  )
  const message = await screen.findByRole('textbox', {
    name: 'Version message',
  })
  fireEvent.change(message, { target: { value: 'My saved change' } })
  fireEvent.click(screen.getByRole('button', { name: 'Review version' }))
  fireEvent.click(
    screen.getByRole('button', { name: 'Confirm and record version' })
  )
  await screen.findByText('Disk changed; preview again')
  fireEvent.click(screen.getByRole('button', { name: 'Refresh Git' }))
  expect(
    await screen.findByRole('textbox', { name: 'Version message' })
  ).toHaveValue('My saved change')
})

it.each([
  { head: null, branch: null, expected: 'No commits yet' },
  { head: null, branch: 'main', expected: 'main · No commits yet' },
  { head: 'head', branch: null, expected: 'Detached HEAD · head' },
])(
  'describes the actual branch state before recording: $expected',
  async state => {
    vi.mocked(commands.previewCreationGitRecord).mockResolvedValueOnce({
      status: 'ok',
      data: {
        token: 'first',
        initial: state.head === null,
        head: state.head,
        branch: state.branch,
        name: 'Creator',
        email: '',
        files: [],
      },
    })
    render(
      <CreationGitRecord
        identity="score"
        onRecorded={vi.fn()}
        onBack={vi.fn()}
      />
    )
    await screen.findByText(state.expected)
  }
)

it('describes a refused Git boundary without claiming that a runtime test failed', async () => {
  vi.mocked(commands.previewCreationGitRecord).mockResolvedValueOnce({
    status: 'error',
    error: {
      code: 'testValidation',
      detail: 'Nested Git repositories require an external Git tool.',
    },
  })
  render(
    <CreationGitRecord identity="score" onRecorded={vi.fn()} onBack={vi.fn()} />
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'This local Git operation cannot continue.'
  )
  expect(screen.getByRole('alert')).toHaveTextContent(
    'Nested Git repositories require an external Git tool.'
  )
  expect(commands.confirmCreationGitRecord).not.toHaveBeenCalled()
})
