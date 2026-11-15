import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  commands,
  type AppPreferences,
  type Manifest,
} from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { NodeSection } from './NodeSection'
import { GeneralSection } from './GeneralSection'
import { SettingsPanel } from './SettingsPanel'
import i18n from '@/i18n/config'

/**
 * Connection preferences keep LAN/Hub/token together. Device identity lives
 * in General; both surfaces preserve their existing queued-save boundaries.
 */
describe('NodeSection (#58)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: null },
    })
    vi.mocked(commands.savePreferences).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    useSettingsStore.setState({
      nodeNameSetting: '',
      hubUrlSetting: '',
      hubTokenSetting: '',
      hubRooms: {},
      hostnameHint: 'Concert-MacBook.local',
    })
    useSessionStore.getState().resetSession()
    useCreationStore.setState({ active: false, workspace: null })
    useProjectStore.setState({
      currentProject: null,
      pendingPreflightPath: null,
      failedPreflightPath: null,
    })
    useSessionStore.setState({
      lanIp: null,
      lanAddresses: [],
      lanAddressesLoaded: false,
    })
  })

  it('keeps full network settings to LAN, Hub and a separately masked token', () => {
    useSessionStore.setState({ lanAddresses: ['192.168.1.10'] })
    render(<NodeSection section="node" />)

    expect(screen.queryByLabelText(/node name/i)).not.toBeInTheDocument()
    expect(screen.getByLabelText(/hub address/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/token/i)).toBeInTheDocument()
    expect(
      screen.getByRole('combobox', { name: /network address/i })
    ).toBeInTheDocument()
  })

  it('masks the token — its own field, never visible as text', () => {
    useSettingsStore.setState({ hubTokenSetting: 'secret-token' })
    render(<NodeSection section="node" />)

    const tokenInput = screen.getByLabelText(/token/i) as HTMLInputElement
    expect(tokenInput.type).toBe('password')
    expect(tokenInput.value).toBe('secret-token')
    // Masked display: the token never renders as page text.
    expect(screen.queryByText('secret-token')).not.toBeInTheDocument()
  })

  it('commits General identity and network edits without clobbering each other', async () => {
    const user = userEvent.setup()
    let preferences: AppPreferences = { theme: 'system', language: null }
    vi.mocked(commands.loadPreferences).mockImplementation(async () => ({
      status: 'ok',
      data: preferences,
    }))
    vi.mocked(commands.savePreferences).mockImplementation(async next => {
      preferences = next
      return { status: 'ok', data: null }
    })
    render(
      <>
        <GeneralSection />
        <NodeSection section="node" />
      </>
    )

    expect(screen.getByLabelText(/node name/i)).toHaveAttribute(
      'placeholder',
      'e.g. Concert-MacBook.local'
    )
    await user.type(screen.getByLabelText(/node name/i), 'Concert-MacBook')
    await user.type(
      screen.getByLabelText(/hub address/i),
      'wss://hub.example.org:3000'
    )
    await user.type(screen.getByLabelText(/token/i), 'secret-token')
    await user.tab()

    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({
          nodeName: 'Concert-MacBook',
          hubUrl: 'wss://hub.example.org:3000',
          hubToken: 'secret-token',
        })
      )
    })
    // The token is stored under its own key — it never rides the URL.
    const payload = vi
      .mocked(commands.savePreferences)
      .mock.calls.at(-1)?.[0] as Record<string, unknown>
    expect(payload.hubUrl).not.toContain('secret-token')

    // Clearing a field commits it back as unset (null).
    await user.clear(screen.getByLabelText(/token/i))
    await user.tab()
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ hubToken: null })
      )
    })
  })

  it('retains the saved identity during an invalid rename', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({ nodeNameSetting: 'Saved Stage' })
    render(<GeneralSection />)
    const name = screen.getByLabelText(/node name/i)
    await user.clear(name)
    await user.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /enter a node name/i
    )
    expect(useSettingsStore.getState().nodeNameSetting).toBe('Saved Stage')
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('publishes a settings rename only after the preference save succeeds', async () => {
    const user = userEvent.setup()
    useSettingsStore.setState({ nodeNameSetting: 'Saved Stage' })
    vi.mocked(commands.savePreferences).mockResolvedValueOnce({
      status: 'error',
      error: 'disk full',
    })
    render(<GeneralSection />)
    const name = screen.getByLabelText(/node name/i)
    await user.clear(name)
    await user.type(name, 'New Stage')
    expect(useSettingsStore.getState().nodeNameSetting).toBe('Saved Stage')
    await user.tab()
    expect(await screen.findByRole('alert')).toHaveTextContent(
      /could not save the name/i
    )
    expect(useSettingsStore.getState().nodeNameSetting).toBe('Saved Stage')
    expect(name).toHaveValue('New Stage')
    await user.click(name)
    await user.tab()
    await waitFor(() =>
      expect(useSettingsStore.getState().nodeNameSetting).toBe('New Stage')
    )
  })

  it('picking a LAN address updates the start config and persists the hand choice (#147)', async () => {
    const user = userEvent.setup()
    const addresses = ['192.168.1.10', '10.0.0.5']
    // Every refresh (panel open AND the address menu refresh, which
    // userEvent fires before picking) enumerates the fixture's two
    // addresses — a persistent override, not a one-shot.
    vi.mocked(commands.listLanAddresses).mockResolvedValue({
      status: 'ok',
      data: addresses,
    })
    useSessionStore.setState({
      lanIp: null,
      lanAddresses: addresses,
    })
    render(<NodeSection section="node" />)

    // The mount refresh lands with nothing chosen: the first address is
    // auto-picked (session-level default, never written to preferences).
    await waitFor(() => {
      expect(useSessionStore.getState().lanIp).toBe('192.168.1.10')
    })
    expect(commands.savePreferences).not.toHaveBeenCalled()

    const lan = screen.getByRole('combobox', { name: /network address/i })
    await user.click(lan)
    await user.click(screen.getByRole('option', { name: '10.0.0.5' }))

    expect(useSessionStore.getState().lanIp).toBe('10.0.0.5')
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ lanIp: '10.0.0.5' })
      )
    })
  })

  it('aligns each LAN icon with its IP and keeps the selected address distinct', async () => {
    const addresses = ['192.168.1.10', '10.0.0.5']
    vi.mocked(commands.listLanAddresses).mockResolvedValue({
      status: 'ok',
      data: addresses,
    })
    vi.mocked(commands.getLanInterfaceKinds).mockResolvedValue({
      status: 'ok',
      data: { '192.168.1.10': 'wifi', '10.0.0.5': 'ethernet' },
    })
    useSessionStore.setState({ lanIp: '10.0.0.5', lanAddresses: addresses })
    render(<NodeSection section="node" />)
    const selected = screen.getByRole('combobox', { name: /network address/i })
    await waitFor(() =>
      expect(selected.querySelector('[data-interface-kind]')).toHaveAttribute(
        'data-interface-kind',
        'ethernet'
      )
    )
    const user = userEvent.setup()
    await user.click(selected)
    expect(
      screen
        .getByRole('option', { name: '192.168.1.10' })
        .querySelector('[data-interface-kind]')
    ).toHaveAttribute('data-interface-kind', 'wifi')
    expect(
      screen
        .getByRole('option', { name: '10.0.0.5' })
        .querySelector('[data-interface-kind]')
    ).toHaveAttribute('data-interface-kind', 'ethernet')
    await user.click(screen.getByRole('option', { name: '192.168.1.10' }))
    expect(useSessionStore.getState().lanIp).toBe('192.168.1.10')
  })

  it('disables the LAN row and shows the placeholder when no address is known', () => {
    vi.mocked(commands.listLanAddresses).mockResolvedValueOnce({
      status: 'ok',
      data: [],
    })
    useSessionStore.setState({ lanAddresses: [] })
    render(<NodeSection section="node" />)
    const lan = screen.getByRole('combobox', { name: /network address/i })
    expect(lan).toBeDisabled()
    expect(lan).toHaveTextContent('Select…')
    // Nothing has been modified — the next-start note stays hidden.
    expect(screen.queryByTestId('node-hint')).not.toBeInTheDocument()
  })

  it('preselects the first address when several networks are listed (#147)', async () => {
    vi.mocked(commands.listLanAddresses).mockResolvedValueOnce({
      status: 'ok',
      data: ['192.168.11.31', '192.168.31.193'],
    })
    render(<NodeSection section="node" />)
    const lan = screen.getByRole('combobox', { name: /network address/i })
    await waitFor(() => expect(lan).toBeEnabled())
    // The pre-fix behavior kept the "Select…" placeholder and a null
    // choice — every multi-interface Mac opened to a gated-gray Load.
    await waitFor(() =>
      expect(useSessionStore.getState().lanIp).toBe('192.168.11.31')
    )
    expect(lan).toHaveTextContent('192.168.11.31')
  })

  it('reveals the next-start note only after a row is modified', async () => {
    const user = userEvent.setup()
    useSessionStore.setState({ lanAddresses: ['192.168.1.10'] })
    render(<NodeSection section="node" />)

    expect(screen.queryByTestId('node-hint')).not.toBeInTheDocument()

    await user.type(
      screen.getByLabelText(/hub address/i),
      'wss://hub.example.org'
    )
    expect(screen.getByTestId('node-hint')).toBeInTheDocument()
  })

  it('a LAN address pick also reveals the note', async () => {
    const user = userEvent.setup()
    const addresses = ['192.168.1.10', '10.0.0.5']
    vi.mocked(commands.listLanAddresses).mockResolvedValue({
      status: 'ok',
      data: addresses,
    })
    useSessionStore.setState({
      lanIp: '192.168.1.10',
      lanAddresses: addresses,
    })
    render(<NodeSection section="node" />)

    expect(screen.queryByTestId('node-hint')).not.toBeInTheDocument()

    await user.click(screen.getByRole('combobox', { name: /network address/i }))
    await user.click(screen.getByRole('option', { name: '10.0.0.5' }))
    expect(screen.getByTestId('node-hint')).toBeInTheDocument()
  })

  it('refreshes the LAN list when the panel opens — no project needed, sole address auto-picked', async () => {
    // First launch, no project opened: preflight never seeded the list,
    // and the row must not sit on the "Select…" placeholder.
    vi.mocked(commands.listLanAddresses).mockResolvedValue({
      status: 'ok',
      data: ['192.168.1.10'],
    })
    useSessionStore.setState({ lanIp: null, lanAddresses: [] })
    render(<NodeSection section="node" />)

    await waitFor(() => {
      expect(useSessionStore.getState().lanAddresses).toEqual(['192.168.1.10'])
    })
    // The sole address is unambiguous and can be picked automatically.
    expect(useSessionStore.getState().lanIp).toBe('192.168.1.10')
    expect(
      screen.getByRole('combobox', { name: /network address/i })
    ).toHaveTextContent('192.168.1.10')
  })

  it('refreshes on each menu open, including reopening with focus still on the trigger', async () => {
    const user = userEvent.setup()
    vi.mocked(commands.listLanAddresses).mockResolvedValue({
      status: 'ok',
      data: ['192.168.1.10'],
    })
    render(<NodeSection section="node" />)
    const lan = screen.getByRole('combobox', { name: /network address/i })
    await waitFor(() => expect(lan).toBeEnabled())
    expect(lan.tagName).toBe('BUTTON')
    await user.click(lan)
    expect(
      screen.getByRole('option', { name: '192.168.1.10' })
    ).toBeInTheDocument()
    await waitFor(() =>
      expect(commands.listLanAddresses).toHaveBeenCalledTimes(2)
    )
    await user.keyboard('{Escape}')
    expect(lan).toHaveFocus()
    await user.keyboard('{Enter}')
    await waitFor(() =>
      expect(commands.listLanAddresses).toHaveBeenCalledTimes(3)
    )
  })

  it('selects the sole available address when the previous network disappears', async () => {
    vi.mocked(commands.listLanAddresses).mockResolvedValueOnce({
      status: 'ok',
      data: ['192.168.1.10'],
    })
    useSessionStore.setState({
      lanIp: '10.0.0.5',
      lanAddresses: ['192.168.1.10', '10.0.0.5'],
    })
    render(<NodeSection section="node" />)

    const lan = screen.getByRole('combobox', { name: /network address/i })
    await waitFor(() => {
      expect(useSessionStore.getState().lanAddresses).toEqual(['192.168.1.10'])
    })
    expect(lan).toHaveTextContent('192.168.1.10')
    expect(lan).toBeEnabled()
  })
})

describe('project connection settings scope', () => {
  const manifest: Manifest = {
    schemaVersion: 1,
    id: 'selected-performance',
    name: 'Manifest name',
    version: '1',
    description: null,
    telematic: true,
    scoreServer: {
      entry: 'server.js',
      workingDirectory: '.',
      performerPort: 9000,
      monitorPort: 9001,
    },
    audio: {
      defaultMode: 'external',
      supportedModes: ['external', 'none'],
      synthdefs: null,
      scsynth: null,
      standaloneTarget: null,
    },
  }
  let preferences: AppPreferences

  beforeEach(() => {
    vi.clearAllMocks()
    preferences = {
      theme: 'system',
      language: null,
      oscTargets: { another: '127.0.0.1:7777' },
      hubRooms: { another: 2 },
    }
    vi.mocked(commands.loadPreferences).mockImplementation(async () => ({
      status: 'ok',
      data: preferences,
    }))
    vi.mocked(commands.savePreferences).mockImplementation(async next => {
      preferences = next
      return { status: 'ok', data: null }
    })
    useSessionStore.getState().resetSession()
    useSessionStore.setState({
      audioMode: 'external',
      oscTargetInput: '127.0.0.1:3333',
      lanAddresses: [],
    })
    useProjectStore.setState({
      currentProject: { path: '/selected', manifest },
      pendingPreflightPath: null,
      failedPreflightPath: null,
      projectDisplayNames: { '/selected': 'Selected stage' },
      manifestProjectNames: {},
    })
    useCreationStore.setState({ active: false, workspace: null })
    useCreationTestStore.setState({
      manifest: null,
      audioMode: 'none',
      oscTarget: '127.0.0.1:4444',
      loading: false,
    })
    useSettingsStore.setState({ hubRooms: { another: 2 } })
  })

  async function openConnections() {
    const summary = screen.getByText(
      i18n.t('settings.presentation.projectConnection')
    )
    const details = summary.closest('details')
    if (!details) throw new Error('Expected project connection disclosure')
    expect(details).not.toHaveAttribute('open')
    await userEvent.click(summary)
    expect(details).toHaveAttribute('open')
    return details
  }

  it('retains OSC and Room through full settings and saves only the selected project keys', async () => {
    useSettingsStore.getState().openSettings('node')
    render(<SettingsPanel />)
    const details = await openConnections()
    expect(within(details).getAllByText(/Selected stage/)).toHaveLength(2)
    const target = within(details).getByLabelText('OSC Target')
    fireEvent.change(target, { target: { value: '127.0.0.1:5555' } })
    fireEvent.blur(target)
    await waitFor(() =>
      expect(preferences.oscTargets).toEqual({
        another: '127.0.0.1:7777',
        'selected-performance': '127.0.0.1:5555',
      })
    )
    await userEvent.click(
      within(details).getByRole('combobox', { name: 'Room' })
    )
    await userEvent.click(screen.getByRole('option', { name: '3' }))
    await waitFor(() =>
      expect(preferences.hubRooms).toEqual({
        another: 2,
        'selected-performance': 3,
      })
    )
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('does not show stale performance controls during a new selection or without an available workspace', () => {
    useProjectStore.setState({ pendingPreflightPath: '/pending' })
    render(<NodeSection section="node" />)
    expect(
      screen.queryByText(i18n.t('settings.presentation.projectConnection'))
    ).not.toBeInTheDocument()
    act(() => {
      useProjectStore.setState({ pendingPreflightPath: null })
      useCreationStore.setState({ active: true, workspace: null })
    })
    expect(
      screen.queryByText(i18n.t('settings.presentation.projectConnection'))
    ).not.toBeInTheDocument()
    act(() => {
      useCreationStore.setState({ active: false })
      useSessionStore.setState({ audioMode: 'none' })
      useProjectStore.setState({
        currentProject: {
          path: '/selected',
          manifest: { ...manifest, telematic: false },
        },
      })
    })
    expect(
      screen.queryByText(i18n.t('settings.presentation.projectConnection'))
    ).not.toBeInTheDocument()
  })

  it('edits the creation workspace target and room without touching performance configuration', async () => {
    useCreationStore.setState({
      active: true,
      workspace: {
        project: {
          identity: 'draft-workspace',
          root: '/draft',
          name: 'Creation draft',
          source: 'folder',
        },
        files: [],
      },
    })
    useCreationTestStore.setState({
      manifest: { ...manifest, id: 'draft-project' },
      audioMode: 'external',
      oscTarget: '127.0.0.1:4444',
    })
    render(<NodeSection section="node" />)
    const details = await openConnections()
    expect(within(details).getAllByText(/Creation draft/)).toHaveLength(2)
    expect(
      within(details).queryByText(/Selected stage/)
    ).not.toBeInTheDocument()
    const target = within(details).getByLabelText('OSC Target')
    expect(target).toHaveValue('127.0.0.1:4444')
    fireEvent.change(target, { target: { value: '127.0.0.1:6666' } })
    fireEvent.blur(target)
    expect(useCreationTestStore.getState().oscTarget).toBe('127.0.0.1:6666')
    expect(useSessionStore.getState().oscTargetInput).toBe('127.0.0.1:3333')
    expect(commands.savePreferences).not.toHaveBeenCalled()
    await userEvent.click(
      within(details).getByRole('combobox', { name: 'Room' })
    )
    await userEvent.click(screen.getByRole('option', { name: '2' }))
    await waitFor(() =>
      expect(preferences.hubRooms).toEqual({ another: 2, 'draft-project': 2 })
    )
    expect(preferences.oscTargets).toEqual({ another: '127.0.0.1:7777' })
  })
})

describe('NodeSection LAN change — Change-button parity (#58)', () => {
  beforeEach(() => {
    useCreationStore.setState({ active: false, workspace: null })
  })

  function seed(path: string, runningPath: string | null) {
    // Persistent: the menu opening fires a second refresh during the
    // pick — both enumerations return the fixture's two addresses.
    vi.mocked(commands.listLanAddresses).mockResolvedValue({
      status: 'ok',
      data: ['192.168.1.10', '10.0.0.5'],
    })
    useProjectStore.setState({
      currentProject: { path, manifest: null as never },
      preflightStatus: 'ready',
    })
    useProjectStore.setState({
      currentProject: {
        path,
        manifest: {
          schemaVersion: 1,
          id: 'x',
          name: 'X',
          version: '0.1.0',
          description: null,
          telematic: null,
          scoreServer: {
            entry: 'server.js',
            workingDirectory: '.',
            performerPort: 6868,
            monitorPort: 6869,
          },
          audio: {
            defaultMode: 'none',
            supportedModes: ['none'],
          },
        } as never,
      },
    })
    useSessionStore.setState({
      sessionStatus: runningPath ? 'ready' : 'idle',
      sessionProjectPath: runningPath,
      lanIp: null,
      lanAddresses: ['192.168.1.10', '10.0.0.5'],
      pendingChanges: false,
    })
  }

  it('flags Change when the running card itself changes LAN', async () => {
    const user = userEvent.setup()
    seed('/p', '/p')
    render(<NodeSection section="node" />)

    const lan = screen.getByRole('combobox', { name: /network address/i })
    await user.click(lan)
    await user.click(screen.getByRole('option', { name: '10.0.0.5' }))

    expect(useSessionStore.getState().lanIp).toBe('10.0.0.5')
    expect(useSessionStore.getState().pendingChanges).toBe(true)
  })

  it('does not flag while another card is selected — that is pre-configuration', async () => {
    const user = userEvent.setup()
    seed('/b', '/a')
    render(<NodeSection section="node" />)

    const lan = screen.getByRole('combobox', { name: /network address/i })
    await user.click(lan)
    await user.click(screen.getByRole('option', { name: '10.0.0.5' }))

    expect(useSessionStore.getState().pendingChanges).toBe(false)
  })
})
