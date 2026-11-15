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
import {
  commands,
  type CreationFile,
  type CreationContent,
  type Result,
  type CreationError,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { seedCreationDraft } from '@/test/creation-files'
import { CreationFileTree } from './CreationFileTree'

const files: CreationFile[] = [
  'manifest.json',
  'README.md',
  'docs/creator-handoff.md',
  'docs/implementation.md',
  'docs/notes.md',
  'package.json',
  'AGENTS.md',
  'public/monitor.html',
  'public/monitor.js',
  'public/performer.html',
  'public/pnds-preview.mjs',
].map(path => ({ path, kind: 'text', category: 'system', size: 10 }))
const props = () => ({
  identity: 'tree',
  files,
  directories: ['docs', 'public', 'empty'],
  selected: null as string | null,
  dirtyPaths: new Set<string>(),
  conflictPaths: new Set<string>(),
  disabled: false,
  editable: true,
  onSelect: vi.fn(),
  onDrag: vi.fn(),
  onFinder: vi.fn(),
  resources: null,
})
const source = (text: string): Result<CreationContent, CreationError> => ({
  status: 'ok',
  data: { kind: 'text', version: 'saved', text },
})

beforeEach(() => {
  vi.clearAllMocks()
  useCreationFilesStore.getState().clear()
  useCreationTestStore.setState({ expanded: false })
  useCreationStore.setState({
    active: true,
    opening: false,
    modePhase: 'idle',
    workspace: {
      project: {
        identity: 'tree',
        root: '/tree',
        name: 'Tree',
        source: 'folder',
      },
      files,
    },
  })
  vi.mocked(commands.readCreationFile).mockImplementation(
    async (_identity, path) =>
      source(
        JSON.stringify(
          path === 'manifest.json'
            ? { sharedLibraries: [{ id: 'socket.io', version: '4.8.4' }] }
            : { dependencies: { 'socket.io': '4.8.4' } }
        )
      )
  )
})

it('switches to real hierarchy and back without selecting or losing the current file or drafts', async () => {
  const options = { ...props(), selected: 'public/monitor.js' }
  seedCreationDraft('public/monitor.js', 'saved code', 'v1')
  useCreationFilesStore.getState().edit('public/monitor.js', 'unsaved code')
  render(<CreationFileTree {...options} />)
  expect(
    screen.getByRole('treeitem', { name: 'public/monitor.html' })
  ).toHaveTextContent('Conductor interface')
  expect(
    screen.getByRole('treeitem', { name: 'public/performer.html' })
  ).toHaveTextContent('Performer interface')
  expect(
    screen.queryByRole('treeitem', { name: 'package.json' })
  ).not.toBeInTheDocument()
  expect(
    screen.getByRole('treeitem', { name: 'Technical files' })
  ).toHaveAttribute('aria-expanded', 'false')
  expect(
    screen.getByRole('treeitem', { name: 'docs/creator-handoff.md' })
  ).toHaveAttribute('aria-level', '1')
  await userEvent.click(screen.getByRole('button', { name: 'File list' }))
  expect(
    screen.getByRole('treeitem', { name: 'public/monitor.html' })
  ).toHaveTextContent(/^monitor.html$/)
  expect(
    screen.getByRole('treeitem', { name: 'docs/creator-handoff.md' })
  ).toHaveAttribute('aria-level', '2')
  expect(
    screen.getByRole('treeitem', { name: 'package.json' })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('treeitem', { name: 'Dependencies' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Purpose view' }))
  expect(
    screen.getByRole('treeitem', { name: 'public/monitor.js' })
  ).toHaveAttribute('aria-selected', 'true')
  expect(
    useCreationFilesStore.getState().drafts['public/monitor.js']?.text
  ).toBe('unsaved code')
  expect(options.onSelect).not.toHaveBeenCalled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('searches Chinese purposes and paths in either view and keeps technical warnings visible', async () => {
  render(
    <CreationFileTree
      {...props()}
      dirtyPaths={new Set(['AGENTS.md'])}
      conflictPaths={new Set(['package.json'])}
    />
  )
  const technical = screen.getByRole('treeitem', { name: 'Technical files' })
  expect(
    within(technical).getByLabelText('Unsaved changes')
  ).toBeInTheDocument()
  expect(within(technical).getByLabelText('Disk changed')).toBeInTheDocument()
  const search = screen.getByRole('searchbox', { name: 'Search file paths' })
  fireEvent.change(search, { target: { value: '指挥界面' } })
  expect(
    screen.getByRole('treeitem', { name: 'public/monitor.html' })
  ).toBeInTheDocument()
  expect(
    screen.queryByRole('treeitem', { name: 'public/performer.html' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Clear search' }))
  expect(search).toHaveFocus()
  expect(search).toHaveValue('')
  expect(
    screen.getByRole('treeitem', { name: 'public/performer.html' })
  ).toBeVisible()
  fireEvent.change(search, { target: { value: '指挥界面' } })
  await userEvent.click(screen.getByRole('button', { name: 'File list' }))
  expect(
    screen.getByRole('treeitem', { name: 'public/monitor.js' })
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Purpose view' }))
  fireEvent.change(search, { target: { value: 'package.json' } })
  expect(
    screen.getByRole('treeitem', { name: 'Technical files' })
  ).toHaveAttribute('aria-expanded', 'true')
  expect(
    screen.getByRole('treeitem', { name: 'package.json' })
  ).toBeInTheDocument()
  fireEvent.change(search, { target: { value: '技术文件' } })
  expect(
    screen.getByRole('treeitem', { name: 'AGENTS.md' })
  ).toBeInTheDocument()
})

it('opens selected technical files and uses keyboard disclosure and inline filtering without synthetic paths', async () => {
  const options = { ...props(), selected: 'package.json' }
  render(<CreationFileTree {...options} />)
  const technical = screen.getByRole('treeitem', { name: 'Technical files' })
  expect(technical).toHaveAttribute('aria-expanded', 'true')
  technical.focus()
  fireEvent.keyDown(technical, { key: 'ArrowLeft' })
  expect(
    screen.queryByRole('treeitem', { name: 'package.json' })
  ).not.toBeInTheDocument()
  fireEvent.keyDown(technical, { key: 'ArrowRight' })
  expect(
    screen.getByRole('treeitem', { name: 'package.json' })
  ).toHaveAttribute('aria-level', '2')
  fireEvent.keyDown(window, { key: 'p', code: 'KeyP', metaKey: true })
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Quick open file' })
  ).not.toBeInTheDocument()
  fireEvent.change(
    screen.getByRole('searchbox', { name: 'Search file paths' }),
    {
      target: { value: '演奏者界面' },
    }
  )
  await userEvent.click(
    screen.getByRole('treeitem', { name: 'public/performer.html' })
  )
  expect(options.onSelect).toHaveBeenCalledWith('public/performer.html')
  await userEvent.click(
    screen.getByRole('button', { name: 'File list actions' })
  )
  expect(
    screen.queryByRole('menuitem', { name: 'Quick open file' })
  ).not.toBeInTheDocument()
  expect(
    screen.queryByRole('menuitem', { name: 'Rescan files' })
  ).not.toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('menuitem', { name: 'Open project folder in Finder' })
  )
  expect(options.onFinder).toHaveBeenCalledOnce()
})

it('summarizes only saved dependency declarations, refreshes after saves and never reads package internals', async () => {
  seedCreationDraft(
    'package.json',
    '{"dependencies":{"draft-only":"9"}}',
    'draft'
  )
  useCreationFilesStore
    .getState()
    .edit('package.json', '{"dependencies":{"draft-only":"10"}}')
  render(<CreationFileTree {...props()} />)
  await userEvent.click(screen.getByRole('treeitem', { name: 'Dependencies' }))
  const dialog = screen.getByRole('dialog')
  expect(
    await within(dialog).findByText('socket.io', { selector: 'strong' })
  ).toBeInTheDocument()
  expect(within(dialog).queryByText('draft-only')).not.toBeInTheDocument()
  expect(
    within(dialog).getAllByText('socket.io', { selector: 'strong' })
  ).toHaveLength(1)
  expect(
    within(dialog).getByText('App shared reference: 4.8.4')
  ).toBeInTheDocument()
  expect(commands.readCreationFile).toHaveBeenCalledTimes(2)
  vi.mocked(commands.readCreationFile).mockImplementation(
    async (_identity, path) =>
      source(
        path === 'manifest.json' ? '{}' : '{"dependencies":{"custom":"^2"}}'
      )
  )
  act(() =>
    useCreationFilesStore.setState({ fileRevisions: { 'package.json': 1 } })
  )
  expect(
    await within(dialog).findByText('custom', { selector: 'strong' })
  ).toBeInTheDocument()
  expect(
    within(dialog).queryByText('socket.io', { selector: 'strong' })
  ).not.toBeInTheDocument()
  expect(
    vi
      .mocked(commands.readCreationFile)
      .mock.calls.every(([, path]) =>
        ['manifest.json', 'package.json'].includes(path)
      )
  ).toBe(true)
  expect(commands.adoptCreationLibrary).not.toHaveBeenCalled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('shows read failures with retry instead of an empty dependency list', async () => {
  vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
    status: 'error',
    error: { code: 'permission', detail: 'manifest.json' },
  })
  render(<CreationFileTree {...props()} />)
  await userEvent.click(screen.getByRole('treeitem', { name: 'Dependencies' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('manifest.json')
  expect(
    screen.queryByText('No dependencies have been declared.')
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Retry' }))
  expect(
    await screen.findByText('socket.io', { selector: 'strong' })
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Close' }))
  await waitFor(() =>
    expect(screen.getByRole('treeitem', { name: 'Dependencies' })).toHaveFocus()
  )
})

it('drops dependency replies from the previous project after switching identities', async () => {
  const replies: ((value: Result<CreationContent, CreationError>) => void)[] =
    []
  vi.mocked(commands.readCreationFile).mockImplementation((identity, path) =>
    identity === 'tree'
      ? new Promise(resolve => replies.push(resolve))
      : Promise.resolve(
          source(
            path === 'manifest.json'
              ? '{}'
              : '{"dependencies":{"new-project-only":"1"}}'
          )
        )
  )
  const options = props()
  const view = render(<CreationFileTree {...options} />)
  await userEvent.click(screen.getByRole('treeitem', { name: 'Dependencies' }))
  expect(replies).toHaveLength(2)
  act(() =>
    useCreationStore.setState({
      workspace: {
        project: {
          identity: 'new',
          root: '/new',
          name: 'New',
          source: 'folder',
        },
        files,
      },
    })
  )
  view.rerender(<CreationFileTree {...options} identity="new" />)
  expect(
    await screen.findByText('new-project-only', { selector: 'strong' })
  ).toBeInTheDocument()
  await act(async () => {
    replies[0]?.(
      source('{"sharedLibraries":[{"id":"private-old-project","version":"1"}]}')
    )
    replies[1]?.(source('{}'))
    await Promise.resolve()
  })
  expect(screen.queryByText('private-old-project')).not.toBeInTheDocument()
  expect(
    screen.getByText('new-project-only', { selector: 'strong' })
  ).toBeInTheDocument()
})

it('hands dependency management to the existing shared-package catalog without adopting anything', async () => {
  vi.mocked(commands.getCreationLibraries).mockResolvedValue({
    status: 'ok',
    data: { manifestVersion: 'm1', projectVersion: '0.1.0', libraries: [] },
  })
  render(<CreationFileTree {...props()} />)
  await userEvent.click(screen.getByRole('treeitem', { name: 'Dependencies' }))
  await screen.findByText('socket.io', { selector: 'strong' })
  await userEvent.click(
    screen.getByRole('button', { name: 'Add shared package' })
  )
  expect(
    await screen.findByRole('heading', { name: 'Add shared package' })
  ).toBeInTheDocument()
  expect(commands.getCreationLibraries).toHaveBeenCalledWith('tree')
  expect(commands.adoptCreationLibrary).not.toHaveBeenCalled()
})
