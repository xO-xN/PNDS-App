import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, render, screen, waitFor, within } from '@/test/test-utils'
import { commands, type CreationModuleCatalog } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationTestStore } from '@/store/creation-test-store'
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
    'hub',
  ].map(id => ({
    id,
    version: '0.2.0',
    shippedVersion: '0.2.0',
    compatibility: {
      version: '0.2.0',
      hostProtocol: 1,
      runtime: ['Node 24', 'Socket.IO 4.x'],
      adaptation: [],
    },
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

it('opens six offline choices from an empty module group and cancels without writes', async () => {
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  expect(
    await screen.findByRole('button', { name: 'QR joining' })
  ).toBeInTheDocument()
  const library = screen.getByRole('list', { name: 'PNDS modules' })
  expect(screen.getByRole('heading', { name: 'Add PNDS module' })).toHaveFocus()
  expect(within(library).getAllByRole('button')).toHaveLength(6)
  expect(screen.queryByRole('combobox')).not.toBeInTheDocument()
  expect(
    screen.queryByRole('button', { name: 'Add files and handoff' })
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  expect(commands.addCreationModule).not.toHaveBeenCalled()
  expect(screen.getByRole('button', { name: 'Add PNDS module' })).toHaveFocus()
})

it('waits for the catalog before the first dialog paint instead of resizing a loading dialog', async () => {
  let resolve!: (
    result: Awaited<ReturnType<typeof commands.getCreationModules>>
  ) => void
  vi.mocked(commands.getCreationModules).mockReturnValueOnce(
    new Promise(done => {
      resolve = done
    })
  )
  render(<CreationView />)
  const trigger = screen.getByRole('button', { name: 'Add PNDS module' })
  await userEvent.click(trigger)
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(trigger).toBeDisabled()
  expect(trigger).toHaveAttribute('aria-busy', 'true')
  await userEvent.click(trigger)
  expect(commands.getCreationModules).toHaveBeenCalledTimes(1)
  await act(async () => resolve({ status: 'ok', data: catalog }))
  const dialog = screen.getByRole('dialog')
  const library = within(dialog).getByRole('list', { name: 'PNDS modules' })
  expect(within(library).getAllByRole('button')).toHaveLength(6)
  expect(screen.getByRole('heading', { name: 'Add PNDS module' })).toHaveFocus()
})

it('opens a recoverable error when the initial catalog read fails', async () => {
  vi.mocked(commands.getCreationModules).mockRejectedValueOnce(
    new Error('Catalog read failed')
  )
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  expect(await screen.findByRole('alert')).toHaveTextContent(
    'Catalog read failed'
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'Reload module status' })
  )
  expect(
    await screen.findByRole('button', { name: 'QR joining' })
  ).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Cancel' }))
  const trigger = screen.getByRole('button', { name: 'Add PNDS module' })
  expect(trigger).toBeEnabled()
  expect(trigger).toHaveFocus()
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
  await userEvent.click(
    await screen.findByRole('button', { name: 'QR joining' })
  )
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
  await userEvent.click(
    await screen.findByRole('button', { name: 'QR joining' })
  )
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
  await userEvent.click(
    await screen.findByRole('button', { name: 'QR joining' })
  )
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
  await userEvent.click(
    await screen.findByRole('button', { name: 'QR joining' })
  )
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

it('shows hub compatibility before adding through the same trusted workflow', async () => {
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  await userEvent.click(
    await screen.findByRole('button', {
      name: 'Hub connection and remote nodes',
    })
  )
  expect(
    screen.getByText('Host protocol 1 · Node 24, Socket.IO 4.x')
  ).toBeInTheDocument()
  await userEvent.click(
    screen.getByRole('button', { name: 'Add files and handoff' })
  )
  await waitFor(() =>
    expect(commands.addCreationModule).toHaveBeenCalledWith(
      'modules',
      'hub',
      null,
      'h1'
    )
  )
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})

it('shows the installed older version and preserves the disabled added state', async () => {
  vi.mocked(commands.getCreationModules).mockResolvedValue({
    status: 'ok',
    data: {
      ...catalog,
      modules: catalog.modules.map(module =>
        module.id === 'qr'
          ? {
              ...module,
              version: '0.1.0',
              state: 'added',
              compatibility: null,
            }
          : module
      ),
    },
  })
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'QR joining' })
  )
  expect(
    await screen.findByText(
      'App provides 0.2.0. Keep the installed source; ask an external agent to review an upgrade.'
    )
  ).toBeInTheDocument()
  expect(
    screen.getByRole('button', { name: 'View wiring handoff' })
  ).toBeEnabled()
  expect(
    screen.queryByRole('button', { name: 'Add files and handoff' })
  ).not.toBeInTheDocument()
  expect(commands.addCreationModule).not.toHaveBeenCalled()
})

it('opens complete module facts and returns keyboard focus to the same library card', async () => {
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  const hub = await screen.findByRole('button', {
    name: 'Hub connection and remote nodes',
  })
  hub.focus()
  await userEvent.keyboard('{Enter}')
  expect(
    screen.getByRole('heading', { name: 'Hub connection and remote nodes' })
  ).toHaveFocus()
  for (const name of [
    'Source and compatibility',
    'Dependencies and prerequisites',
    'Technical boundary',
    'Wiring requirements',
    'Verification',
    'Module files',
  ]) {
    expect(screen.getByText(name)).toBeInTheDocument()
  }
  expect(screen.getByText('modules/pnds-hub/hub.js')).toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Back to modules' }))
  expect(
    screen.getByRole('button', { name: 'Hub connection and remote nodes' })
  ).toHaveFocus()
  expect(
    screen.queryByRole('button', { name: 'Add files and handoff' })
  ).not.toBeInTheDocument()
  expect(commands.addCreationModule).not.toHaveBeenCalled()
})

it('opens an added module handoff in the editor without overwriting the current draft', async () => {
  const workspace = useCreationStore.getState().workspace
  if (!workspace) throw new Error('Expected workspace')
  useCreationStore.setState({
    workspace: {
      ...workspace,
      files: [
        {
          path: 'docs/creator-handoff.md',
          kind: 'text',
          category: 'system',
          size: 16,
        },
      ],
    },
  })
  seedCreationDraft('docs/creator-handoff.md', 'Saved handoff', 'h1')
  useCreationFilesStore
    .getState()
    .edit('docs/creator-handoff.md', 'Author task draft')
  useCreationTestStore.getState().setTab('console')
  vi.mocked(commands.getCreationModules).mockResolvedValue({
    status: 'ok',
    data: {
      ...catalog,
      modules: catalog.modules.map(module => ({ ...module, state: 'added' })),
    },
  })
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  await userEvent.click(
    await screen.findByRole('button', { name: 'QR joining' })
  )
  await userEvent.click(
    screen.getByRole('button', { name: 'View wiring handoff' })
  )
  expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  expect(useCreationFilesStore.getState().activePath).toBe(
    'docs/creator-handoff.md'
  )
  expect(
    useCreationFilesStore.getState().drafts['docs/creator-handoff.md']?.text
  ).toBe('Author task draft')
  expect(useCreationTestStore.getState().tab).toBe('file')
  expect(commands.addCreationModule).not.toHaveBeenCalled()
  expect(commands.saveCreationFile).not.toHaveBeenCalled()
  expect(commands.startCreationProject).not.toHaveBeenCalled()
})

it('shows a conflict in the library and details while refusing to overwrite', async () => {
  vi.mocked(commands.getCreationModules).mockResolvedValue({
    status: 'ok',
    data: {
      ...catalog,
      modules: catalog.modules.map(module =>
        module.id === 'qr'
          ? {
              ...module,
              state: 'conflict',
              error: { code: 'targetExists', detail: 'modules/pnds-qr' },
            }
          : module
      ),
    },
  })
  render(<CreationView />)
  await userEvent.click(screen.getByRole('button', { name: 'Add PNDS module' }))
  const card = await screen.findByRole('button', { name: 'QR joining' })
  expect(within(card).getByText('Target conflict')).toBeInTheDocument()
  await userEvent.click(card)
  expect(screen.getByRole('alert')).toHaveTextContent('modules/pnds-qr')
  expect(
    screen.getByRole('button', { name: 'Add files and handoff' })
  ).toBeDisabled()
  expect(commands.addCreationModule).not.toHaveBeenCalled()
})
