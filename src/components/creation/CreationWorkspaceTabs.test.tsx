import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import { seedCreationDraft } from '@/test/creation-files'
import { commands } from '@/lib/tauri-bindings'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useSessionStore } from '@/store/session-store'
import { CreationView } from './CreationView'

const path = 'docs/creator-handoff.md'
function Workspace() {
  useCommandKeyboard()
  return <CreationView />
}
beforeEach(() => {
  vi.clearAllMocks()
  useCreationReadingStore.getState().syncWorkspace(null)
  useCreationFilesStore.getState().clear()
  useSessionStore.setState({ sessionStatus: 'idle', commandPending: false })
  useCreationStore.setState({
    active: true,
    modePhase: 'idle',
    opening: false,
    workspace: {
      project: {
        identity: 'tabs',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      directories: ['docs', 'public'],
      files: [
        { path, kind: 'text', category: 'system', size: 8 },
        { path: 'public/Grid.js', kind: 'text', category: 'pages', size: 8 },
      ],
    },
  })
})
it('saves the visible handoff with Cmd+S and retains the code draft when its tab closes', async () => {
  seedCreationDraft('public/Grid.js', 'code', 'code-v1')
  seedCreationDraft(path, '# Handoff', 'doc-v1')
  useCreationFilesStore.getState().edit('public/Grid.js', 'keep code')
  useCreationFilesStore.getState().setActivePath('public/Grid.js')
  vi.mocked(commands.saveCreationFile).mockResolvedValue({
    status: 'ok',
    data: 'doc-v2',
  })
  render(<Workspace />)
  const nav = within(
    screen.getByRole('navigation', { name: 'Workspace reading views' })
  )
  expect(nav.queryByRole('button', { name: 'Handoff' })).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('treeitem', { name: path }))
  act(() => useCreationFilesStore.getState().edit(path, '# Changed handoff'))
  fireEvent.keyDown(window, { key: 's', code: 'KeyS', metaKey: true })
  await waitFor(() =>
    expect(commands.saveCreationFile).toHaveBeenCalledWith(
      'tabs',
      path,
      '# Changed handoff',
      'doc-v1'
    )
  )
  expect(useCreationFilesStore.getState().drafts['public/Grid.js']?.text).toBe(
    'keep code'
  )
  await userEvent.click(
    nav.getByRole('button', { name: 'Close file view; keep its draft' })
  )
  expect(useCreationFilesStore.getState().activePath).toBeNull()
  expect(useCreationFilesStore.getState().drafts['public/Grid.js']?.text).toBe(
    'keep code'
  )
  expect(useCreationReadingStore.getState().view).toBe('discussion')
  expect(useCreationFilesStore.getState().drafts[path]?.text).toBe(
    '# Changed handoff'
  )
})
it('renames inline with F2, selecting the stem, while retaining unsaved content', async () => {
  seedCreationDraft('public/Grid.js', 'base', 'v1')
  useCreationFilesStore.getState().edit('public/Grid.js', 'keep code')
  vi.mocked(commands.renameCreationFile).mockResolvedValue({
    status: 'ok',
    data: 'public/Pattern.js',
  })
  render(<Workspace />)
  const row = screen.getByRole('treeitem', { name: 'public/Grid.js' })
  row.focus()
  fireEvent.keyDown(row, { key: 'F2' })
  const field = screen.getByRole('textbox', {
    name: 'New file name',
  }) as HTMLInputElement
  expect(field.selectionStart).toBe(0)
  expect(field.selectionEnd).toBe(4)
  fireEvent.change(field, { target: { value: 'Pattern.js' } })
  const form = field.closest('form')
  if (!form) throw new Error('Expected inline rename form')
  fireEvent.submit(form)
  await waitFor(() =>
    expect(
      useCreationFilesStore.getState().drafts['public/Pattern.js']?.text
    ).toBe('keep code')
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(
    screen.getByRole('treeitem', { name: 'public/Pattern.js' })
  ).toBeVisible()
})

it('creates an empty folder from the focused directory and focuses new-file input after menus close', async () => {
  let created = false
  vi.mocked(commands.createCreationDirectory).mockImplementationOnce(
    async () => {
      created = true
      return { status: 'ok', data: 'public/new' }
    }
  )
  vi.mocked(commands.pollCreationChanges).mockImplementation(async () => ({
    status: 'ok',
    data: {
      files: useCreationStore.getState().workspace?.files ?? [],
      changed: [],
      revision: 0,
      directories: created
        ? ['docs', 'public', 'public/new']
        : ['docs', 'public'],
    },
  }))
  render(<Workspace />)
  screen.getByRole('treeitem', { name: 'public' }).focus()
  await userEvent.click(screen.getByRole('button', { name: 'New…' }))
  await userEvent.click(screen.getByRole('menuitem', { name: 'New folder' }))
  const form = await screen.findByRole('form', { name: 'New folder' })
  const input = within(form).getByRole('textbox')
  expect(input).toHaveFocus()
  fireEvent.change(input, { target: { value: 'new' } })
  await userEvent.click(
    within(form).getByRole('button', { name: 'Create folder' })
  )
  expect(
    await screen.findByRole('treeitem', { name: 'public/new' })
  ).toBeVisible()
  expect(commands.createCreationDirectory).toHaveBeenCalledWith(
    'tabs',
    'public/new',
    []
  )
  expect(commands.createCreationFile).not.toHaveBeenCalled()
})
