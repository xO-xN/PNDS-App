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
import { handoffPrompt } from '@/lib/assistant-handoff-prompt'
import { useAssistantStore } from '@/store/assistant-store'
import i18n from '@/i18n/config'

const task: HandoffTask = {
  id: '701a5180-a2dd-47dc-9319-9312f3790f64',
  intent: 'Connect a module',
  files: ['server.js', 'new.js'],
  acceptance: 'Check both outputs',
  status: 'pending',
}
beforeEach(() => {
  vi.clearAllMocks()
  useAssistantStore.setState({ owner: null, messages: [] })
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

it('copies a manual Chinese task in Chinese even with English UI', () => {
  useCreationHandoffStore.setState({
    receipt: {
      task: { ...task, intent: '让触摸控制音量，并保持释放尾音。' },
      revision: 'r1',
      document: { text: '', version: 'h2' },
      instructions: 'English native receipt',
      taskRecorded: true,
      baselineId: 'b1',
      baselineError: null,
    },
  })
  render(<CreationHandoff editable exists />)
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy handoff instructions' })
  )
  expect(writeText).toHaveBeenCalledWith(handoffPrompt('/score', 'zh-CN'))
})

it('uses the language of this recorded task instead of an unrelated active conversation or changed UI', async () => {
  const previous = i18n.language
  await act(() => i18n.changeLanguage('zh-CN'))
  try {
    useAssistantStore.setState({
      owner: 'p',
      messages: [
        {
          id: 'recorded',
          role: 'assistant',
          text: 'Recorded.',
          sources: [],
          scope: 'project',
          status: 'completed',
          handoff: {
            taskId: task.id,
            revision: 'r1',
            prompt: handoffPrompt('/old', 'en'),
          },
        },
        {
          id: 'other',
          role: 'user',
          text: '现在讨论另一个中文任务。',
          sources: [],
          scope: 'project',
          status: 'completed',
        },
      ],
    })
    useCreationHandoffStore.setState({
      receipt: {
        task: { ...task, intent: '让触摸控制音量。' },
        revision: 'r1',
        document: { text: '', version: 'h2' },
        instructions: 'Native receipt',
        taskRecorded: true,
        baselineId: 'b1',
        baselineError: null,
      },
    })
    render(<CreationHandoff editable exists />)
    fireEvent.click(screen.getByRole('button', { name: '复制交接说明' }))
    expect(writeText).toHaveBeenCalledWith(handoffPrompt('/score', 'en'))
  } finally {
    await act(() => i18n.changeLanguage(previous))
  }
})
it('reviews before recording, cancels without writing, and copying never appends again', async () => {
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
  await screen.findByRole('button', { name: 'Confirm write' })
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(commands.appendCreationHandoff).not.toHaveBeenCalled()
  await act(() => useCreationHandoffStore.getState().open())
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm write' }))
  await waitFor(() =>
    expect(commands.confirmCreationHandoff).toHaveBeenCalledTimes(1)
  )
  fireEvent.click(
    await screen.findByRole('button', { name: 'Copy handoff instructions' })
  )
  fireEvent.click(
    screen.getByRole('button', { name: 'Copy handoff instructions' })
  )
  expect(writeText).toHaveBeenCalledWith(handoffPrompt('/score'))
  expect(commands.confirmCreationHandoff).toHaveBeenCalledTimes(1)
})

it('shows an absent recorded task as history and requires an explicit new identity before adding it again', async () => {
  render(<CreationHandoff editable exists />)
  await act(() =>
    useCreationHandoffStore.getState().prepareTask(task, undefined, true)
  )
  expect(screen.getByText('Previously recorded')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Edit task' })).toBeDisabled()
  expect(screen.getByRole('button', { name: 'Preview handoff' })).toBeDisabled()
  expect(commands.previewCreationHandoff).not.toHaveBeenCalled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Create a new task from this record' })
  )
  expect(useCreationHandoffStore.getState().activeId).not.toBe(task.id)
  expect(screen.getByText('Awaiting implementation')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Preview handoff' })).toBeEnabled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})

it('opens a readable task sheet with compact files and an explicit edit mode', async () => {
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  expect(screen.getByRole('dialog')).toHaveClass('creation-handoff-dialog')
  expect(screen.getByText('Score')).toBeVisible()
  expect(screen.getByText('docs/creator-handoff.md')).toBeVisible()
  expect(screen.getByText('Awaiting implementation')).toBeVisible()
  expect(screen.getByText(task.intent)).toBeVisible()
  expect(screen.getByText(task.acceptance)).toBeVisible()
  expect(screen.getByText('2 affected files')).toBeVisible()
  expect(
    screen.queryByRole('textbox', { name: 'Intent' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByLabelText('Status supplied by you')
  ).not.toBeInTheDocument()
  expect(screen.queryByText('Current handoff on disk')).not.toBeInTheDocument()
  expect(screen.getByDisplayValue('Existing agent status')).not.toBeVisible()
  fireEvent.click(screen.getByRole('button', { name: 'Edit task' }))
  const intent = screen.getByRole('textbox', { name: 'Intent' })
  expect(intent).toHaveValue(task.intent)
  fireEvent.change(intent, {
    target: { value: 'Connect only the chosen module' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Read task' }))
  expect(screen.getByText('Connect only the chosen module')).toBeVisible()
  expect(commands.previewCreationHandoff).not.toHaveBeenCalled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})

it('shows the exact native write preview and archive destination before confirmation', async () => {
  vi.mocked(commands.previewCreationHandoff).mockResolvedValueOnce({
    status: 'ok',
    data: {
      token: 'review',
      identity: 'p',
      task,
      revision: 'r1',
      fingerprint: 'files-v1',
      document: { text: 'Existing agent status', version: 'h1' },
      plannedText:
        '# Active tasks\n\nThe independent old task stays.\n\n## Updated module task\n\nOnly the selected module changes.',
      archivePath: 'docs/handoff-history/previous.md',
    },
  })
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
  expect(
    await screen.findByRole('heading', { name: 'Active tasks' })
  ).toBeVisible()
  expect(screen.getByText('The independent old task stays.')).toBeVisible()
  expect(screen.getByText('docs/handoff-history/previous.md')).toBeVisible()
  expect(screen.getByRole('button', { name: 'Confirm write' })).toBeEnabled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})

it('keeps old-content edits in the review flow instead of silently saving them', async () => {
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  fireEvent.click(screen.getByText('Manage existing content'))
  const existing = screen.getByRole('textbox', {
    name: 'Existing active task list',
  })
  expect(existing).toBeVisible()
  fireEvent.change(existing, {
    target: { value: 'Corrected independent task' },
  })
  expect(useCreationHandoffStore.getState().documentEdit).toBe(
    'Corrected independent task'
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Preview handoff' })).toBeEnabled()
  fireEvent.click(
    screen.getByRole('button', { name: 'Reset to saved content' })
  )
  expect(existing).toHaveValue('Existing agent status')
  expect(useCreationHandoffStore.getState().documentEdit).toBeNull()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('lets the creator target a bounded existing task without adopting its old requirements', async () => {
  const existingId = 'e878761d-184e-4d28-8982-76057637451b'
  vi.mocked(commands.readCreationHandoff).mockResolvedValueOnce({
    status: 'ok',
    data: {
      text: `# Active tasks\n\n<!-- pnds-task:${existingId} -->\n## Existing module task\n\nStatus / 状态: pending\n\nOld requirements\n<!-- pnds-task-revision:${existingId}:${'a'.repeat(64)} -->\n`,
      version: 'h1',
    },
  })
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  const target = screen.getByRole('combobox', { name: 'Handoff task' })
  expect(target).toHaveTextContent('New task')
  fireEvent.keyDown(target, { key: 'ArrowDown' })
  fireEvent.click(
    await screen.findByRole('option', { name: 'Update: Existing module task' })
  )
  expect(useCreationHandoffStore.getState().activeId).toBe(existingId)
  expect(useCreationHandoffStore.getState().pending[0]?.task.intent).toBe(
    task.intent
  )
  expect(screen.getByText(task.intent)).toBeVisible()
  expect(commands.previewCreationHandoff).not.toHaveBeenCalled()
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})

it('requires a draft choice and keeps an unsaved handoff conflicted against the actual task write', async () => {
  const { seedCreationDraft } = await import('@/test/creation-files')
  seedCreationDraft('docs/creator-handoff.md', 'old tasks', 'h1')
  useCreationFilesStore
    .getState()
    .edit('docs/creator-handoff.md', 'my unsaved task draft')
  render(<CreationHandoff editable exists />)
  await act(() => useCreationHandoffStore.getState().prepareTask(task))
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
  await screen.findAllByText('docs/creator-handoff.md')
  expect(commands.previewCreationHandoff).not.toHaveBeenCalled()
  fireEvent.click(screen.getByRole('button', { name: 'Use saved files only' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm write' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
  const button = await screen.findByRole('button', {
    name: 'Confirm write',
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
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm write' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm write' }))
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
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
  const confirmButton = await screen.findByRole('button', {
    name: 'Confirm write',
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
  fireEvent.click(screen.getByRole('button', { name: 'Preview handoff' }))
  fireEvent.click(await screen.findByRole('button', { name: 'Confirm write' }))
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
