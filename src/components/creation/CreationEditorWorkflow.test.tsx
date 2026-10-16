import { beforeEach, expect, it, vi } from 'vitest'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { editorView, editText, findEditorWithText } from '@/test/text-editor'
import { creationFileButton } from '@/test/desktop-actions'
import { commands, type CreationWorkspace } from '@/lib/tauri-bindings'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { openCreationFileAtLine } from '@/lib/creation-editor-navigation'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { TextBuffer } from '@/lib/text-buffer'
import { CreationView } from './CreationView'
import { TextEditor } from './TextEditor'
import { useAssistantStore } from '@/store/assistant-store'
import { useAssistantProjectStore } from '@/store/assistant-project-store'

const workspace: CreationWorkspace = {
  project: {
    identity: 'editor-project',
    root: '/score',
    name: 'Score',
    source: 'folder',
  },
  files: [
    { path: 'public/score.js', category: 'pages', kind: 'text', size: 20 },
    { path: 'server.ts', category: 'system', kind: 'text', size: 12 },
    {
      path: 'huge.txt',
      category: 'system',
      kind: 'text',
      size: 2 * 1024 * 1024,
    },
  ],
}
function Keyboard() {
  useCommandKeyboard()
  return null
}

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
  useCreationTestStore.setState({ tab: 'file', expanded: false })
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  vi.mocked(commands.readCreationFile).mockImplementation(
    async (_identity, path) =>
      path === 'huge.txt'
        ? { status: 'error', error: { code: 'tooLarge', detail: path } }
        : {
            status: 'ok',
            data: {
              kind: 'text',
              text:
                path === 'server.ts' ? 'const b = 2' : '// 潮汐\nconst a = 1',
              version: 'disk-1',
            },
          }
  )
})

it('adds the real editor selection as a fixed draft attachment without saving or sending (#225)', async () => {
  vi.mocked(commands.assistantProjectRead).mockResolvedValue({
    status: 'ok',
    data: {
      path: 'public/score.js',
      version: 'disk-1',
      text: 'saved',
      offset: 0,
      endOffset: 5,
      totalCharacters: 5,
      nextOffset: null,
      startLine: 1,
      endLine: 1,
    },
  })
  render(<CreationView />)
  fireEvent.click(creationFileButton('public/score.js'))
  editText(
    await findEditorWithText('// 潮汐\nconst a = 1'),
    '// do not attach\nconst a = 77\n// other draft'
  )
  await waitFor(() =>
    expect(
      useCreationFilesStore.getState().drafts['public/score.js']?.editor
    ).toBeDefined()
  )
  const buffer =
    useCreationFilesStore.getState().drafts['public/score.js']?.editor
  if (!buffer) throw new Error('The public file editor was not ready')
  act(() => buffer.select(17, 29))
  fireEvent.click(screen.getByRole('button', { name: 'Discuss selection' }))
  await waitFor(() =>
    expect(useAssistantProjectStore.getState().attachments).toHaveLength(1)
  )
  expect(
    useAssistantProjectStore.getState().attachments[0]?.snapshot
  ).toMatchObject({
    path: 'public/score.js',
    source: 'draft',
    text: 'const a = 77',
    startLine: 2,
    endLine: 2,
  })
  expect(
    screen.getByRole('region', { name: 'Selected code attachments' })
  ).toBeInTheDocument()
  expect(commands.beginAssistantRequest).not.toHaveBeenCalled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  act(() => buffer.replaceSelection('const a = 88'))
  expect(await screen.findByText(/The source has changed/)).toBeInTheDocument()
  expect(
    useAssistantProjectStore.getState().attachments[0]?.snapshot.text
  ).toBe('const a = 77')
  fireEvent.click(
    screen.getByRole('button', { name: 'Remove public/score.js attachment' })
  )
  expect(useAssistantProjectStore.getState().attachments).toEqual([])
  expect(useAssistantStore.getState().messages).toEqual([])
})

it('keeps undo and redo with each draft across file, dock and monitor layout changes', async () => {
  render(<CreationView />)
  fireEvent.click(creationFileButton('public/score.js'))
  editText(
    await findEditorWithText('// 潮汐\nconst a = 1'),
    '// 波浪\nconst a = 3'
  )
  fireEvent.click(creationFileButton('server.ts'))
  editText(await findEditorWithText('const b = 2'), 'const b = 4')
  act(() => useCreationTestStore.getState().setExpanded(true))
  act(() => useCreationTestStore.getState().setExpanded(false))
  act(() => useCreationTestStore.getState().setTab('console'))
  act(() => useCreationTestStore.getState().setTab('file'))
  fireEvent.click(screen.getByRole('button', { name: 'Undo draft edit' }))
  await findEditorWithText('const b = 2')
  fireEvent.click(creationFileButton('public/score.js'))
  await findEditorWithText('// 波浪\nconst a = 3')
  fireEvent.click(screen.getByRole('button', { name: 'Undo draft edit' }))
  await findEditorWithText('// 潮汐\nconst a = 1')
  fireEvent.click(screen.getByRole('button', { name: 'Redo draft edit' }))
  await findEditorWithText('// 波浪\nconst a = 3')
  expect(useCreationFilesStore.getState().drafts['server.ts']?.text).toBe(
    'const b = 2'
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})

it('quick opens only listed files, exposes read limits, and locates a trusted file line', async () => {
  render(<CreationView />)
  fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true })
  const dialog = await screen.findByRole('dialog', { name: 'Quick open file' })
  const query = within(dialog).getByRole('combobox', {
    name: 'File name or relative path',
  })
  fireEvent.change(query, { target: { value: '../secret.txt' } })
  expect(within(dialog).queryAllByRole('option')).toHaveLength(0)
  fireEvent.keyDown(query, { key: 'Enter' })
  expect(commands.readCreationFile).not.toHaveBeenCalled()
  fireEvent.change(query, { target: { value: 'huge' } })
  fireEvent.keyDown(query, { key: 'Enter' })
  await waitFor(() =>
    expect(commands.readCreationFile).toHaveBeenCalledWith(
      'editor-project',
      'huge.txt'
    )
  )
  expect(
    await screen.findByText(/The file or file list exceeds the reading limit/)
  ).toBeVisible()
  expect(openCreationFileAtLine('old-project', 'server.ts', 1)).toBe(false)
  expect(openCreationFileAtLine('editor-project', '../secret.txt', 1)).toBe(
    false
  )
  expect(openCreationFileAtLine('editor-project', 'server.ts', 0)).toBe(false)
  act(() => {
    expect(openCreationFileAtLine('editor-project', 'public/score.js', 2)).toBe(
      true
    )
  })
  const editor = await findEditorWithText('// 潮汐\nconst a = 1')
  expect(editorView(editor).state.selection.main.head).toBe(6)
  expect(useCreationFilesStore.getState().activePath).toBe('public/score.js')
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('keeps read-only source files out of writable drafts', async () => {
  useCreationStore.setState({
    workspace: {
      ...workspace,
      project: { ...workspace.project, source: 'bundle' },
    },
  })
  render(
    <>
      <Keyboard />
      <CreationView />
    </>
  )
  fireEvent.click(creationFileButton('public/score.js'))
  const editor = await findEditorWithText('// 潮汐\nconst a = 1')
  expect(editorView(editor).state.readOnly).toBe(true)
  fireEvent.keyDown(editor, { key: 's', code: 'KeyS', metaKey: true })
  expect(useCreationFilesStore.getState().drafts).toEqual({})
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('locates read-only README source without widening its editing permissions', async () => {
  useCreationStore.setState({
    workspace: {
      ...workspace,
      project: { ...workspace.project, source: 'bundle' },
      files: [
        { path: 'README.md', category: 'system', kind: 'text', size: 19 },
      ],
    },
  })
  vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: { kind: 'text', text: '# Title\n\nDetails\n', version: 'readme-1' },
  })
  render(<CreationView />)
  act(() => {
    expect(openCreationFileAtLine('editor-project', 'README.md', 3)).toBe(true)
  })
  const editor = await screen.findByRole('textbox', { name: 'README.md' })
  expect(editorView(editor).state.selection.main.head).toBe(9)
  expect(editorView(editor).state.readOnly).toBe(true)
  expect(useCreationFilesStore.getState().drafts).toEqual({})
})

it('keeps editing history after save and resets it when a clean draft adopts a new disk version', async () => {
  render(<CreationView />)
  fireEvent.click(creationFileButton('server.ts'))
  editText(await findEditorWithText('const b = 2'), 'const b = 3')
  vi.mocked(commands.saveCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: 'disk-2',
  })
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
  await waitFor(() =>
    expect(
      useCreationFilesStore.getState().drafts['server.ts']?.diskVersion
    ).toBe('disk-2')
  )
  fireEvent.click(screen.getByRole('button', { name: 'Undo draft edit' }))
  await findEditorWithText('const b = 2')
  expect(commands.saveCreationFile).toHaveBeenCalledTimes(1)
  fireEvent.click(screen.getByRole('button', { name: 'Redo draft edit' }))
  await findEditorWithText('const b = 3')
  vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
    status: 'ok',
    data: { kind: 'text', text: 'const b = 5', version: 'disk-3' },
  })
  vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
    status: 'ok',
    data: { files: workspace.files, changed: ['server.ts'], revision: 1 },
  })
  await act(async () => {
    await useCreationFilesStore.getState().poll()
  })
  await findEditorWithText('const b = 5')
  expect(screen.getByRole('button', { name: 'Undo draft edit' })).toBeDisabled()
  expect(
    screen.getByText(/Draft undo and redo history was reset/)
  ).toBeVisible()
  expect(commands.saveCreationFile).toHaveBeenCalledTimes(1)
})

it('gives a suggestion its own edit history and prevents its save chord from saving a file', async () => {
  const suggestion = new TextBuffer('suggestion', 'suggestion.js')
  render(
    <>
      <Keyboard />
      <CreationView />
      <TextEditor buffer={suggestion} value="suggestion" />
    </>
  )
  fireEvent.click(creationFileButton('server.ts'))
  editText(await findEditorWithText('const b = 2'), 'file draft')
  const editor = screen.getByRole('textbox', { name: 'suggestion.js' })
  editText(editor, 'edited suggestion')
  fireEvent.keyDown(editor, { key: 's', code: 'KeyS', metaKey: true })
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(useCreationFilesStore.getState().drafts['server.ts']?.text).toBe(
    'file draft'
  )
  act(() => {
    suggestion.undo()
  })
  expect(suggestion.text).toBe('suggestion')
})
