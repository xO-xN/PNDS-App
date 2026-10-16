import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type HandoffTask } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { CreationHandoff } from './CreationHandoff'
import { CreationHandoffBaselines } from './CreationHandoffBaselines'
import { useCreationReadingStore } from '@/store/creation-reading-store'

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

it('does not label a later failed manual task as recorded after an earlier success', async () => {
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  fireEvent.click(screen.getByRole('button', { name: 'Add to handoff' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Confirm this handoff' })
  )
  await screen.findByText('Handoff recorded · Baseline ready')
  fireEvent.click(screen.getByRole('button', { name: 'Record a manual task' }))
  fireEvent.change(await screen.findByLabelText('Intent'), {
    target: { value: 'Later manual task' },
  })
  fireEvent.change(screen.getByLabelText('Affected files (one per line)'), {
    target: { value: 'server.js' },
  })
  fireEvent.change(screen.getByLabelText('Acceptance criteria'), {
    target: { value: 'Record only after successful writing' },
  })
  vi.mocked(commands.confirmCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: {
      task: { ...task, id: 'later-task', intent: 'Later manual task' },
      revision: 'r2',
      document: { text: 'Existing agent status\nNew task', version: 'h2' },
      instructions: 'Later task r2',
      taskRecorded: false,
      baselineId: 'b2',
      baselineError: { code: 'io', detail: 'Task write failed' },
    },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Add to handoff' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Confirm this handoff' })
  )
  await screen.findByText(/Task was not recorded/)
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(screen.queryByText('Handoff recorded')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Copy handoff instructions' })
  ).not.toBeInTheDocument()
})

it('shows a newly confirmed baseline while the comparison view remains open', async () => {
  useCreationReadingStore.getState().syncWorkspace('p')
  useCreationReadingStore
    .getState()
    .showExtension(
      { id: 'handoff-baselines', title: 'Changes', content: null },
      'reply'
    )
  vi.mocked(commands.listHandoffBaselines).mockResolvedValue({
    status: 'ok',
    data: { usedBytes: 0, limitBytes: 268435456, baselines: [] },
  })
  render(
    <>
      <CreationHandoff editable exists />
      <CreationHandoffBaselines identity="p" />
    </>
  )
  await screen.findByText('No handoff baselines for this project.')
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  fireEvent.click(screen.getByRole('button', { name: 'Add to handoff' }))
  const confirmButton = await screen.findByRole('button', {
    name: 'Confirm this handoff',
  })
  vi.mocked(commands.listHandoffBaselines).mockResolvedValue({
    status: 'ok',
    data: {
      usedBytes: 500,
      limitBytes: 268435456,
      baselines: [
        {
          id: 'b1',
          taskId: task.id,
          task,
          intent: task.intent,
          revision: 'r1',
          capturedAt: 1700000000000,
          complete: true,
          bytes: 500,
          files: 2,
          excluded: [],
          error: null,
        },
      ],
    },
  })
  fireEvent.click(confirmButton)
  await screen.findByRole('heading', { name: 'Connect a module' })
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

it('shows byte progress and waits for the actual native cancellation outcome', async () => {
  let finish!: (
    result: Awaited<ReturnType<typeof commands.confirmCreationHandoff>>
  ) => void
  vi.mocked(commands.handoffOperationProgress).mockResolvedValue({
    status: 'ok',
    data: {
      phase: 'hashing',
      cancellable: true,
      path: 'sound.wav',
      bytesRead: 65536,
      bytesTotal: 1048576,
      files: 2,
    },
  })
  vi.mocked(commands.confirmCreationHandoff).mockImplementation(
    () =>
      new Promise(resolve => {
        finish = resolve
      })
  )
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  fireEvent.click(screen.getByRole('button', { name: 'Add to handoff' }))
  fireEvent.click(
    await screen.findByRole('button', { name: 'Confirm this handoff' })
  )
  const progress = await screen.findByRole('progressbar', {
    name: 'Fingerprint progress for sound.wav',
  })
  expect(progress).toHaveAttribute('value', '65536')
  await waitFor(() =>
    expect(commands.confirmCreationHandoff).toHaveBeenCalled()
  )
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  await waitFor(() =>
    expect(commands.cancelHandoffOperation).toHaveBeenCalledWith('operation')
  )
  expect(useCreationHandoffStore.getState().busy).toBe(true)
  await act(async () => {
    finish({
      status: 'error',
      error: { code: 'cancelled', detail: 'Collection cancelled' },
    })
  })
  expect(useCreationHandoffStore.getState().recorded).toBe(false)
  expect(useCreationHandoffStore.getState().busy).toBe(false)
  expect(commands.appendCreationHandoff).not.toHaveBeenCalled()
})
