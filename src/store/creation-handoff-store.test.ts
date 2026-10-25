import { beforeEach, expect, it, vi } from 'vitest'
import { commands, type HandoffTask } from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import { useCreationHandoffStore } from './creation-handoff-store'
import { useCreationFilesStore } from './creation-files-store'

const id = '701a5180-a2dd-47dc-9319-9312f3790f64'
const previousId = '801a5180-a2dd-47dc-9319-9312f3790f64'
const text = `# Active work\n<!-- pnds-task:${previousId} -->\n## Existing task\nStatus / 状态: pending\nOld requirements\n<!-- pnds-task-end:${previousId} -->\n`
const task: HandoffTask = {
  id,
  intent: 'Implement the agreed sound layer',
  files: ['audio.js'],
  acceptance: 'Check the original mappings',
  status: 'pending',
}

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    workspace: {
      project: {
        identity: 'handoff',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationFilesStore.getState().clear()
  useCreationHandoffStore.getState().clear()
  vi.mocked(commands.readCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: { text, version: 'h1' },
  })
})

it('retains the exact existing-content edit and its old version through cancel/reopen until explicitly reset', async () => {
  const store = useCreationHandoffStore.getState
  await store().prepareTask(task)
  store().editDocument('# Corrected active content')
  store().cancel()
  vi.mocked(commands.readCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: { text: 'Changed externally', version: 'h2' },
  })
  await store().open(id)
  expect(store().documentEdit).toBe('# Corrected active content')
  await store().record()
  expect(commands.previewCreationHandoffUpdate).toHaveBeenCalledWith(
    'handoff',
    task,
    {
      text: '# Corrected active content',
      version: 'h1',
    }
  )
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  store().resetDocumentEdit()
  store().editDocument('Reviewed external text with correction')
  await store().record()
  expect(commands.previewCreationHandoffUpdate).toHaveBeenLastCalledWith(
    'handoff',
    task,
    {
      text: 'Reviewed external text with correction',
      version: 'h2',
    }
  )
})

it('selects only a bounded existing task for correction and can create a new task without losing its origin', async () => {
  const store = useCreationHandoffStore.getState
  await store().prepareTask(task)
  store().replaceTaskId('unissued')
  expect(store().activeId).toBe(id)
  store().replaceTaskId(previousId)
  expect(store().pending).toHaveLength(1)
  expect(store().pending[0]).toMatchObject({
    originId: id,
    task: { id: previousId, intent: task.intent },
  })
  store().cancel()
  await store().prepareTask(task)
  expect(store().pending).toHaveLength(1)
  expect(store().activeId).toBe(previousId)
  store().replaceTaskId('')
  expect(store().activeId).not.toBe(id)
  expect(store().activeId).not.toBe(previousId)
  expect(store().pending[0]?.originId).toBe(id)
  expect(store().pending[0]?.task.intent).toBe(task.intent)
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})

it('refreshes a first-preview conflict while retaining creator edits until reset', async () => {
  const store = useCreationHandoffStore.getState
  await store().prepareTask(task)
  store().editDocument('My correction against h1')
  vi.mocked(commands.readCreationHandoff).mockResolvedValue({
    status: 'ok',
    data: { text: 'Fresh external content', version: 'h2' },
  })
  vi.mocked(commands.previewCreationHandoffUpdate).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'versionConflict', detail: 'Changed active list' },
  })
  await store().record()
  expect(store().conflict).toBe(true)
  expect(store().document).toMatchObject({ version: 'h2' })
  expect(store().documentEdit).toBe('My correction against h1')
  store().resetDocumentEdit()
  store().editDocument('Reviewed correction against h2')
  await store().record()
  expect(commands.previewCreationHandoffUpdate).toHaveBeenLastCalledWith(
    'handoff',
    task,
    { text: 'Reviewed correction against h2', version: 'h2' }
  )
  expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
})

it.each([text, '# Active work\n'])(
  'creates a fresh task identity from a recorded task whether it is active or absent (%s)',
  async currentText => {
    const store = useCreationHandoffStore.getState
    vi.mocked(commands.readCreationHandoff).mockResolvedValue({
      status: 'ok',
      data: { text: currentText, version: 'h1' },
    })
    await store().prepareTask({ ...task, id: previousId }, undefined, true)
    if (!currentText.includes(`<!-- pnds-task:${previousId} -->`)) {
      await store().record()
      expect(commands.previewCreationHandoff).not.toHaveBeenCalled()
    }
    store().replaceTaskId('')
    expect(store().activeId).not.toBe(previousId)
    expect(store().pending).toHaveLength(1)
    expect(store().pending[0]?.originId).toBe(previousId)
    expect(store().pending[0]?.recordedSource).toBe(false)
    expect(store().pending[0]?.task.intent).toBe(task.intent)
    expect(commands.confirmCreationHandoff).not.toHaveBeenCalled()
  }
)
