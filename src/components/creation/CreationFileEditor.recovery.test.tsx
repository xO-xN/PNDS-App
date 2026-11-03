import { beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { creationFileAction } from '@/test/desktop-actions'
import { findEditorWithText } from '@/test/text-editor'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { CreationFileEditor } from './CreationFileEditor'

type ReadResult = Awaited<ReturnType<typeof commands.readCreationFile>>
const file = {
  path: 'server.ts',
  category: 'system' as const,
  kind: 'text' as const,
  size: 20,
}
const workspace: CreationWorkspace = {
  project: {
    identity: 'editor-recovery',
    root: '/editor-recovery',
    name: 'Recovery',
    source: 'folder',
  },
  files: [file],
}
const saved = (text: string): ReadResult => ({
  status: 'ok',
  data: { kind: 'text', text, version: text },
})

beforeEach(() => {
  vi.clearAllMocks()
  useCreationStore.setState({
    active: true,
    workspace: null,
    opening: false,
    modePhase: 'idle',
  })
  useCreationStore.setState({ workspace })
  useCreationFilesStore.getState().clear()
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  vi.mocked(commands.readCreationFile)
    .mockReset()
    .mockResolvedValue(saved('saved code'))
  vi.mocked(commands.renameCreationFile)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: '新文件.ts' })
  vi.mocked(commands.listCreationFiles)
    .mockReset()
    .mockResolvedValue({ status: 'ok', data: [{ ...file, path: '新文件.ts' }] })
})

it.each([{ isComposing: true }, { keyCode: 229 }])(
  'keeps IME confirmation Enter from renaming a file (%o)',
  async nativeState => {
    render(
      <CreationFileEditor identity="editor-recovery" file={file} editable />
    )
    await findEditorWithText('saved code')
    await creationFileAction('Rename')
    const input = await screen.findByRole('textbox', {
      name: 'Path inside the project',
    })
    fireEvent.change(input, { target: { value: '新文件.ts' } })
    fireEvent.keyDown(input, { key: 'Enter', ...nativeState })
    expect(commands.renameCreationFile).not.toHaveBeenCalled()
    expect(input).toHaveValue('新文件.ts')
    fireEvent.keyDown(input, { key: 'Enter' })
    await waitFor(() =>
      expect(commands.renameCreationFile).toHaveBeenCalledOnce()
    )
    expect(commands.renameCreationFile).toHaveBeenCalledWith(
      'editor-recovery',
      'server.ts',
      '新文件.ts',
      []
    )
  }
)

it.each(['error action', 'file menu'] as const)(
  'retries a failed first read of the same file through the %s',
  async entry => {
    vi.mocked(commands.readCreationFile).mockRejectedValueOnce(
      new Error('temporary read failure')
    )
    render(
      <CreationFileEditor identity="editor-recovery" file={file} editable />
    )
    expect(await screen.findByText('temporary read failure')).toBeVisible()
    expect(useCreationFilesStore.getState().drafts).toEqual({})
    if (entry === 'error action')
      fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
    else await creationFileAction('Reload from disk')
    await findEditorWithText('saved code')
    expect(screen.queryByText('temporary read failure')).not.toBeInTheDocument()
    expect(commands.readCreationFile).toHaveBeenCalledTimes(2)
    expect(useCreationFilesStore.getState().drafts[file.path]?.text).toBe(
      'saved code'
    )
    expect(commands.saveCreationFile).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
  }
)

it('discards a retried read after switching to another workspace', async () => {
  let resolveRetry!: (result: ReadResult) => void
  vi.mocked(commands.readCreationFile)
    .mockRejectedValueOnce(new Error('temporary read failure'))
    .mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRetry = resolve
        })
    )
    .mockResolvedValueOnce(saved('new project code'))
  const view = render(
    <CreationFileEditor
      key="old"
      identity="editor-recovery"
      file={file}
      editable
    />
  )
  await screen.findByText('temporary read failure')
  fireEvent.click(screen.getByRole('button', { name: 'Retry' }))
  await waitFor(() =>
    expect(commands.readCreationFile).toHaveBeenCalledTimes(2)
  )
  act(() =>
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: { ...workspace.project, identity: 'next-project' },
      },
    })
  )
  view.rerender(
    <CreationFileEditor
      key="new"
      identity="next-project"
      file={file}
      editable
    />
  )
  await findEditorWithText('new project code')
  await act(async () => {
    resolveRetry(saved('late old project code'))
  })
  expect(screen.queryByText('late old project code')).not.toBeInTheDocument()
  expect(useCreationFilesStore.getState().drafts[file.path]?.text).toBe(
    'new project code'
  )
})
