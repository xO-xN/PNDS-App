import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type HandoffTask } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { CreationHandoff } from './CreationHandoff'

const task: HandoffTask = {
  id: '701a5180-a2dd-47dc-9319-9312f3790f64',
  intent: 'Connect a module',
  files: ['server.js', 'new.js'],
  acceptance: 'Check both outputs',
  status: 'pending',
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'p',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationHandoffStore.getState().clear()
  useCreationFilesStore.getState().clear()
  vi.mocked(commands.readCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: { text: 'Existing agent status', version: 'h1' },
  })
  vi.mocked(commands.previewCreationHandoff).mockImplementation(
    async (identity, next) => ({
      status: 'ok',
      data: {
        token: 'review',
        identity,
        task: next,
        revision: 'r1',
        fingerprint: 'files-v1',
        document: { text: 'Existing agent status', version: 'h1' },
      },
    })
  )
  vi.mocked(commands.confirmCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: {
      task,
      revision: 'r1',
      document: { text: 'Existing agent status\nNew task', version: 'h2' },
      instructions: 'Copy this specific task r1',
      taskRecorded: true,
      baselineId: 'b1',
      baselineError: null,
    },
  })
})
it('reviews before recording, cancels without writing, and copying never appends again', async () => {
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  fireEvent.click(screen.getByRole('button', { name: 'Add to handoff' }))
  await screen.findByRole('button', { name: 'Confirm this handoff' })
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(commands.appendCreationHandoff).not.toHaveBeenCalled()
  await act(() => useCreationHandoffStore.getState().open())
  fireEvent.click(screen.getByRole('button', { name: 'Add to handoff' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Confirm this handoff' })
  )
  await waitFor(() =>
    expect(commands.confirmCreationHandoff).toHaveBeenCalledTimes(1)
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Copy handoff instructions' })
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy handoff instructions' })
  )
  expect(writeText).toHaveBeenCalledWith('Copy this specific task r1')
  expect(commands.confirmCreationHandoff).toHaveBeenCalledTimes(1)
})

it('requires a draft choice and keeps an unsaved handoff conflicted against the actual task write', async () => {
  const { seedCreationDraft } = await import('@/test/creation-files')
  seedCreationDraft('docs/creator-handoff.md', 'old tasks', 'h1')
  useCreationFilesStore
    .getState()
    .edit('docs/creator-handoff.md', 'my unsaved task draft')
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  fireEvent.click(screen.getByRole('button', { name: 'Add to handoff' }))
  await screen.findByText('docs/creator-handoff.md')
  expect(commands.previewCreationHandoff).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Use saved files only' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Confirm this handoff' })
  )
  await waitFor(() =>
    expect(useCreationHandoffStore.getState().receipt).not.toBeNull()
  )
  const draft =
    useCreationFilesStore.getState().drafts['docs/creator-handoff.md']
  expect(draft?.text).toBe('my unsaved task draft')
  expect(draft?.conflict?.version).toBe('h2')
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('stops save-first handoff when a required draft save conflicts', async () => {
  const { seedCreationDraft } = await import('@/test/creation-files')
  seedCreationDraft('server.js', 'old', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'draft')
  vi.mocked(commands.saveCreationFile).mockResolvedValue({
    status: 'error',
    error: { code: 'versionConflict', detail: 'server.js' },
  })
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  fireEvent.click(screen.getByRole('button', { name: 'Add to handoff' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Save drafts first' })
  )
  await waitFor(() => expect(commands.saveCreationFile).toHaveBeenCalled())
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  expect(commands.previewCreationHandoff).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['server.js']?.text).toBe(
    'draft'
  )
})

it('reports task success and baseline failure separately without claiming comparison readiness', async () => {
  vi.mocked(commands.confirmCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: {
      task,
      revision: 'r1',
      document: { text: 'Recorded task', version: 'h2' },
      instructions: 'Task r1',
      taskRecorded: true,
      baselineId: 'b1',
      baselineError: {
        code: 'io',
        detail: 'Disk full while finalizing baseline',
      },
    },
  })
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  fireEvent.click(screen.getByRole('button', { name: 'Add to handoff' }))
  const button = await screen.findByRole('button', {
    name: 'Confirm this handoff',
  })
  fireEvent.click(button)
  fireEvent.click(button)
  await screen.findByText(
    /Task recorded, but the comparison baseline is not complete/
  )
  expect(
    screen.queryByText(/Saved-file comparison baseline recorded/)
  ).not.toBeInTheDocument()
  expect(commands.confirmCreationHandoff).toHaveBeenCalledTimes(1)
})

it('settles the original pending task when its captured handoff is retried successfully', async () => {
  const { useHandoffBaselinesStore } =
    await import('@/store/handoff-baselines-store')
  await useCreationHandoffStore.getState().prepareTask(task)
  useCreationHandoffStore.getState().cancel()
  vi.mocked(commands.retryHandoffBaseline).mockResolvedValue({
    status: 'ok',
    data: {
      task,
      revision: 'r1',
      document: { text: 'Recorded task', version: 'h2' },
      instructions: 'Task r1',
      taskRecorded: true,
      baselineId: 'b1',
      baselineError: null,
    },
  })
  await useHandoffBaselinesStore.getState().retry('b1')
  expect(useCreationHandoffStore.getState().pending).toHaveLength(0)
})
