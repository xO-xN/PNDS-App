import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor } from '@/test/test-utils'
import { commands, type CreationModuleCatalog } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { seedCreationDraft } from '@/test/creation-files'
import { CreationView } from './CreationView'

const catalog: CreationModuleCatalog = {
  handoffVersion: 'h1',
  modules: [
    'qr',
    'players',
    'theme-follow',
    'locale-follow',
    'monitor-state',
  ].map(id => ({
    id,
    version: '0.1.0',
    source: {
      repository: 'https://github.com/xO-xN/PNDS-Template',
      revision: 'e3f4769',
      version: '0.5.1',
    },
    files: [`modules/pnds-${id}/${id}.js`],
    state: 'available',
    recordVersion: null,
    error: null,
  })),
}

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
        identity: 'modules',
        root: '/score',
        name: 'Score',
        source: 'folder',
      },
      files: [],
    },
  })
  vi.mocked(commands.getCreationModules).mockResolvedValue({
    status: 'ok',
    data: catalog,
  })
  vi.mocked(commands.pollCreationChanges).mockImplementation(async () => ({
    status: 'ok',
    data: {
      changed: [],
      files: useCreationStore.getState().workspace?.files ?? [],
      revision: 0,
    },
  }))
  vi.mocked(commands.addCreationModule).mockResolvedValue({
    status: 'ok',
    data: {
      files: ['modules/pnds-qr/qr.js'],
      handoffRecorded: true,
      alreadyAdded: false,
      error: null,
    },
  })
})

it('opens five offline choices from an empty module group and cancels without writes', async () => {
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  expect(
    await screen.findByRole('option', { name: 'QR joining' })
  ).toBeInTheDocument()
  expect(screen.getAllByRole('option')).toHaveLength(5)
  expect(screen.getByText(/qrcode/)).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(commands.addCreationModule).not.toHaveBeenCalled()
})

it('adds through the trusted command, refreshes real files and keeps the runtime untouched', async () => {
  let added = false
  vi.mocked(commands.addCreationModule).mockImplementation(async () => {
    added = true
    return {
      status: 'ok',
      data: {
        files: ['modules/pnds-qr/qr.js'],
        handoffRecorded: true,
        alreadyAdded: false,
        error: null,
      },
    }
  })
  vi.mocked(commands.pollCreationChanges).mockImplementation(async () => ({
    status: 'ok',
    data: {
      changed: added ? ['modules/pnds-qr/qr.js'] : [],
      files: added
        ? [
            {
              path: 'modules/pnds-qr/qr.js',
              kind: 'text',
              category: 'modules',
              size: 20,
            },
          ]
        : [],
      revision: added ? 1 : 0,
    },
  }))
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  await screen.findByRole('option', { name: 'QR joining' })
  await userEvent.click(
    screen.getByRole('button', { name: 'Add files and handoff' })
  )
  expect(
    await screen.findByText(/Module files added and wiring task recorded/)
  ).toBeInTheDocument()
  expect(commands.addCreationModule).toHaveBeenCalledWith(
    'modules',
    'qr',
    null,
    'h1'
  )
  await waitFor(() =>
    expect(useCreationStore.getState().workspace?.files[0]?.path).toBe(
      'modules/pnds-qr/qr.js'
    )
  )
  expect(commands.startCreationProject).not.toHaveBeenCalled()
  expect(commands.stopProject).not.toHaveBeenCalled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
})

it('refuses to append over an unsaved handoff draft', async () => {
  seedCreationDraft('docs/creator-handoff.md', 'saved', 'v1')
  useCreationFilesStore
    .getState()
    .edit('docs/creator-handoff.md', 'unsaved task')
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  await screen.findByRole('option', { name: 'QR joining' })
  await userEvent.click(
    screen.getByRole('button', { name: 'Add files and handoff' })
  )
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Save or resolve unsaved'
  )
  expect(commands.addCreationModule).not.toHaveBeenCalled()
})

it('reports partial file publication and retries only the handoff after reloading disk status', async () => {
  vi.mocked(commands.addCreationModule).mockResolvedValueOnce({
    status: 'ok',
    data: {
      files: ['modules/pnds-qr/qr.js'],
      handoffRecorded: false,
      alreadyAdded: false,
      error: { code: 'versionConflict', detail: 'docs/creator-handoff.md' },
    },
  })
  const pending = {
    ...catalog,
    handoffVersion: 'h2',
    modules: catalog.modules.map(module =>
      module.id === 'qr'
        ? { ...module, state: 'needsHandoff' as const, recordVersion: 'r1' }
        : module
    ),
  }
  vi.mocked(commands.getCreationModules)
    .mockResolvedValueOnce({ status: 'ok', data: catalog })
    .mockResolvedValue({ status: 'ok', data: pending })
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  await screen.findByRole('option', { name: 'QR joining' })
  await userEvent.click(
    screen.getByRole('button', { name: 'Add files and handoff' })
  )
  expect(
    await screen.findByText(/handoff was not recorded/)
  ).toBeInTheDocument()
  expect(screen.getByRole('alert')).toHaveTextContent('docs/creator-handoff.md')
  await userEvent.click(
    screen.getByRole('button', { name: 'Reload module status' })
  )
  await waitFor(() =>
    expect(screen.getByRole('button', { name: 'Retry handoff' })).toBeEnabled()
  )
  await userEvent.click(screen.getByRole('button', { name: 'Retry handoff' }))
  await waitFor(() =>
    expect(commands.addCreationModule).toHaveBeenLastCalledWith(
      'modules',
      'qr',
      'r1',
      'h2'
    )
  )
  expect(
    await screen.findByText(/Module files added and wiring task recorded/)
  ).toBeInTheDocument()
})

it.each(['bundle', 'utility', 'readOnlyFolder'] as const)(
  'keeps the module write entry absent for %s sources',
  source => {
    const workspace = useCreationStore.getState().workspace
    if (!workspace) throw new Error('Expected the writable workspace fixture')
    useCreationStore.setState({
      workspace: { ...workspace, project: { ...workspace.project, source } },
    })
    render(<CreationView />)
    expect(
      screen.queryByRole('button', { name: 'Add PNDS module' })
    ).not.toBeInTheDocument()
  }
)

it('discards a late add result after a project switch', async () => {
  let resolve!: (
    result: Awaited<ReturnType<typeof commands.addCreationModule>>
  ) => void
  vi.mocked(commands.addCreationModule).mockReturnValueOnce(
    new Promise(done => {
      resolve = done
    })
  )
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  await screen.findByRole('option', { name: 'QR joining' })
  await userEvent.click(
    screen.getByRole('button', { name: 'Add files and handoff' })
  )
  act(() =>
    useCreationStore.setState({
      workspace: {
        project: {
          identity: 'next',
          root: '/next',
          name: 'Next',
          source: 'folder',
        },
        files: [],
      },
    })
  )
  await act(async () =>
    resolve({
      status: 'ok',
      data: {
        files: ['modules/pnds-qr/qr.js'],
        handoffRecorded: true,
        alreadyAdded: false,
        error: null,
      },
    })
  )
  expect(
    screen.queryByText(/Module files added and wiring task recorded/)
  ).not.toBeInTheDocument()
  expect(useCreationStore.getState().workspace?.files).toEqual([])
})
