import { beforeEach, expect, it, vi } from 'vitest'
import { fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { commands, type AssistantTask } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useAssistantStore } from '@/store/assistant-store'
import { seedCreationDraft } from '@/test/creation-files'
import { AssistantTasks } from './AssistantTasks'
const task: AssistantTask = {
  id: 'recovered-native-task',
  mode: 'edit',
  files: [
    { path: 'server.js', created: false, undone: false },
    { path: 'public/monitor.html', created: true, undone: false },
  ],
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'owner',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  useAssistantStore.setState({ phase: 'idle' })
  vi.mocked(commands.listCreationAssistantTasks).mockResolvedValue({
    status: 'ok',
    data: [structuredClone(task)],
  })
})
it('shows recovered changes and provides task and per-file undo', async () => {
  vi.mocked(commands.undoCreationAssistantTask).mockResolvedValueOnce({
    status: 'ok',
    data: {
      ...task,
      files: task.files.map(file => ({
        ...file,
        undone: file.path === 'public/monitor.html',
      })),
    },
  })
  render(<AssistantTasks identity="owner" />)
  fireEvent.click(
    await screen.findByRole('button', { name: 'Undo public/monitor.html' })
  )
  await waitFor(() =>
    expect(commands.undoCreationAssistantTask).toHaveBeenCalledWith(
      'owner',
      'recovered-native-task',
      'public/monitor.html'
    )
  )
  expect(screen.getByRole('button', { name: 'Undo task' })).toBeInTheDocument()
})
it('preserves unsaved creator edits and shows external modification conflicts', async () => {
  seedCreationDraft('server.js', 'before', 'v1')
  useCreationFilesStore.getState().edit('server.js', 'creator draft')
  render(<AssistantTasks identity="owner" />)
  fireEvent.click(await screen.findByRole('button', { name: 'Undo task' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Save or discard unsaved edits'
  )
  expect(commands.undoCreationAssistantTask).not.toHaveBeenCalled()
  useCreationFilesStore.getState().clear()
  vi.mocked(commands.undoCreationAssistantTask).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'versionConflict', detail: 'server.js' },
  })
  fireEvent.click(screen.getByRole('button', { name: 'Undo task' }))
  await waitFor(() =>
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Files changed after this task'
    )
  )
})
