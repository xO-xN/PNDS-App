import { beforeEach, expect, it, vi } from 'vitest'
import { confirm, save } from '@tauri-apps/plugin-dialog'
import { render, screen, fireEvent, waitFor, act } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationDraftsStore } from '@/store/creation-drafts-store'
import { useSessionStore } from '@/store/session-store'
import { CreationView } from './CreationView'

beforeEach(() => {
  vi.clearAllMocks()
  useSessionStore.getState().resetSession()
  useCreationStore.setState({ workspace: null })
  useCreationStore.setState({
    active: true,
    modePhase: 'idle',
    opening: false,
    workspace: {
      project: {
        identity: 'pack',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  vi.mocked(commands.getBundleOutputInfo).mockImplementation(
    async (_root, output) => ({
      status: 'ok',
      data: { outputPath: output ?? '/Score-1.0.0.pnds', exists: false },
    })
  )
  vi.mocked(commands.packProjectBundle).mockResolvedValue({
    status: 'ok',
    data: { outputPath: '/delivery/Score-1.0.0.pnds', sha256: 'abc123' },
  })
  vi.mocked(confirm).mockResolvedValue(false)
  vi.mocked(save).mockResolvedValue(null)
})

it('allows cancelling the untested warning or the native save dialog without output', async () => {
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Generate .pnds' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Generate .pnds' })).toBeEnabled()
  )
  expect(save).not.toHaveBeenCalled()
  expect(commands.getBundleOutputInfo).not.toHaveBeenCalled()
  vi.mocked(confirm).mockResolvedValueOnce(true)
  fireEvent.click(screen.getByRole('button', { name: 'Generate .pnds' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Generate .pnds' })).toBeEnabled()
  )
  expect(commands.packProjectBundle).not.toHaveBeenCalled()
})

it('confirms the selected existing output and preserves it on cancellation, then passes explicit overwrite approval', async () => {
  vi.mocked(commands.getBundleOutputInfo).mockImplementation(
    async (_root, output) => ({
      status: 'ok',
      data: {
        outputPath: output ?? '/Score-1.0.0.pnds',
        exists: output !== null,
      },
    })
  )
  vi.mocked(save).mockResolvedValue('/delivery/existing.pnds')
  vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(false)
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Generate .pnds' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(2))
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Generate .pnds' })).toBeEnabled()
  )
  expect(confirm).toHaveBeenLastCalledWith(
    expect.stringContaining('/delivery/existing.pnds'),
    expect.objectContaining({ okLabel: 'Overwrite' })
  )
  expect(commands.packProjectBundle).not.toHaveBeenCalled()
  vi.mocked(confirm).mockResolvedValueOnce(true).mockResolvedValueOnce(true)
  fireEvent.click(screen.getByRole('button', { name: 'Generate .pnds' }))
  await waitFor(() =>
    expect(commands.packProjectBundle).toHaveBeenCalledWith(
      '/score',
      true,
      '/delivery/existing.pnds'
    )
  )
})

it('reports a static validation failure and leaves the running project and drafts alone', async () => {
  vi.mocked(confirm).mockResolvedValueOnce(true)
  vi.mocked(commands.getBundleOutputInfo).mockResolvedValueOnce({
    status: 'error',
    error: 'audio.synthdefs[] not found: missing.scsyndef',
  })
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Generate .pnds' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('missing.scsyndef')
  expect(save).not.toHaveBeenCalled()
  expect(commands.packProjectBundle).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.compileCreationSynthdefs).not.toHaveBeenCalled()
})

it('does not count starting, failed or another project as a successful test', async () => {
  useSessionStore.setState({
    sessionStatus: 'starting',
    sessionProjectPath: '/score',
  })
  useSessionStore.setState({
    sessionStatus: 'error',
    sessionError: 'Test failed',
  })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/elsewhere',
  })
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Generate .pnds' }))
  await waitFor(() =>
    expect(confirm).toHaveBeenCalledWith(
      expect.stringContaining('No successful test'),
      expect.any(Object)
    )
  )
  expect(save).not.toHaveBeenCalled()
})

it('ignores a late destination after switching projects and prevents duplicate clicks', async () => {
  vi.mocked(confirm).mockResolvedValueOnce(true)
  let choose!: (value: string | null) => void
  vi.mocked(save).mockImplementationOnce(
    () =>
      new Promise(resolve => {
        choose = resolve
      })
  )
  render(<CreationView />)
  const button = screen.getByRole('button', { name: 'Generate .pnds' })
  fireEvent.click(button)
  fireEvent.click(button)
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  await act(async () => {
    useCreationStore.setState({
      workspace: {
        project: {
          identity: 'other',
          root: '/other',
          name: 'Other',
          source: 'folder',
        },
        files: [],
      },
    })
    choose('/delivery/old-project.pnds')
  })
  expect(commands.packProjectBundle).not.toHaveBeenCalled()
  expect(
    screen.queryByText('/delivery/old-project.pnds')
  ).not.toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Generate .pnds' })).toBeEnabled()
})

it('offers packaging only for a writable source folder', () => {
  const workspace = useCreationStore.getState().workspace
  if (!workspace) throw new Error('Expected the source workspace')
  useCreationStore.setState({
    workspace: {
      ...workspace,
      project: { ...workspace.project, source: 'bundle' },
    },
  })
  render(<CreationView />)
  expect(
    screen.queryByRole('button', { name: 'Generate .pnds' })
  ).not.toBeInTheDocument()
})

it('remembers a successful ready test after closing it, but resets the record for another workspace', async () => {
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/score',
  })
  useSessionStore.getState().resetSession()
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Generate .pnds' }))
  await waitFor(() => expect(save).toHaveBeenCalledTimes(1))
  expect(confirm).not.toHaveBeenCalled()
  await act(async () => {
    useCreationStore.setState({
      workspace: {
        project: {
          identity: 'other',
          root: '/other',
          name: 'Other',
          source: 'folder',
        },
        files: [],
      },
    })
  })
  fireEvent.click(screen.getByRole('button', { name: 'Generate .pnds' }))
  await waitFor(() => expect(confirm).toHaveBeenCalledTimes(1))
  expect(save).toHaveBeenCalledTimes(1)
})

it('packages only the saved project at a chosen destination while preserving unsaved drafts and the runtime', async () => {
  useCreationDraftsStore
    .getState()
    .loaded('README.md', 'Saved introduction', 'v1')
  useCreationDraftsStore.getState().edit('README.md', 'Unsaved introduction')
  vi.mocked(confirm).mockResolvedValueOnce(true)
  vi.mocked(save).mockResolvedValueOnce('/delivery/Score-1.0.0.pnds')
  render(<CreationView />)
  fireEvent.click(screen.getByRole('button', { name: 'Generate .pnds' }))
  await waitFor(() =>
    expect(commands.packProjectBundle).toHaveBeenCalledWith(
      '/score',
      false,
      '/delivery/Score-1.0.0.pnds'
    )
  )
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining('No successful test'),
    expect.any(Object)
  )
  expect(confirm).toHaveBeenCalledWith(
    expect.stringContaining('Unsaved drafts'),
    expect.any(Object)
  )
  expect(save).toHaveBeenCalledWith(
    expect.objectContaining({ defaultPath: '/Score-1.0.0.pnds' })
  )
  expect(await screen.findByText('/delivery/Score-1.0.0.pnds')).toBeVisible()
  expect(screen.getByText('abc123')).toBeVisible()
  expect(useCreationDraftsStore.getState().drafts['README.md']?.text).toBe(
    'Unsaved introduction'
  )
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.preflightProject).not.toHaveBeenCalled()
  expect(commands.preflightCreationProject).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
})
