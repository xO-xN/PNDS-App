import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { NodeSection } from './NodeSection'

/**
 * #58: the settings Node section — the machine's telematic identity, set
 * once: node name (hostname placeholder), hub address, token (own field,
 * masked) and the LAN address (moved from the sidebar card). Edits are
 * optimistic; persistence commits on blur.
 */
describe('NodeSection (#58)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      nodeNameSetting: '',
      hubUrlSetting: '',
      hubTokenSetting: '',
      hubRooms: {},
      hostnameHint: 'Concert-MacBook.local',
    })
    useSessionStore.getState().resetSession()
  })

  it('renders the three identity fields plus the LAN row, with the hostname placeholder', () => {
    useSessionStore.setState({ lanAddresses: ['192.168.1.10'] })
    render(<NodeSection section="node" />)

    expect(screen.getByLabelText(/node name/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/node name/i)).toHaveAttribute(
      'placeholder',
      'e.g. Concert-MacBook.local'
    )
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

  it('commits the trio on blur — each as its own field, blanks as null', async () => {
    const user = userEvent.setup()
    render(<NodeSection section="node" />)

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

  it('picking a LAN address updates the start config (no persistence — it is not a preference)', async () => {
    const user = userEvent.setup()
    const addresses = ['192.168.1.10', '10.0.0.5']
    // Every refresh (panel open AND the select's focus refresh, which
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

    const lan = screen.getByRole('combobox', { name: /network address/i })
    await user.selectOptions(lan, '10.0.0.5')

    expect(useSessionStore.getState().lanIp).toBe('10.0.0.5')
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('disables the LAN row and shows the placeholder option when no address is known', () => {
    vi.mocked(commands.listLanAddresses).mockResolvedValueOnce({
      status: 'ok',
      data: [],
    })
    useSessionStore.setState({ lanAddresses: [] })
    render(<NodeSection section="node" />)
    const lan = screen.getByRole('combobox', { name: /network address/i })
    expect(lan).toBeDisabled()
    expect(lan).toHaveDisplayValue('Select…')
    // Nothing has been modified — the next-start note stays hidden.
    expect(screen.queryByTestId('node-hint')).not.toBeInTheDocument()
  })

  it('reveals the next-start note only after a row is modified', async () => {
    const user = userEvent.setup()
    useSessionStore.setState({ lanAddresses: ['192.168.1.10'] })
    render(<NodeSection section="node" />)

    expect(screen.queryByTestId('node-hint')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/node name/i), 'Xiang')
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

    await user.selectOptions(
      screen.getByRole('combobox', { name: /network address/i }),
      '10.0.0.5'
    )
    expect(screen.getByTestId('node-hint')).toBeInTheDocument()
  })

  it('refreshes the LAN list when the panel opens — no project needed, first address auto-picked', async () => {
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
    // Preflight's auto-pick policy: a yet-unpicked selection takes the
    // first address.
    expect(useSessionStore.getState().lanIp).toBe('192.168.1.10')
    expect(
      screen.getByRole('combobox', { name: /network address/i })
    ).toHaveDisplayValue('192.168.1.10')
  })

  it('keeps the selected address visible when a refresh shrinks the list', async () => {
    // The network changed under the selection: the refresh drops
    // 10.0.0.5, but the row must still show what is selected instead of
    // blanking.
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
    expect(lan).toHaveDisplayValue('10.0.0.5')
    expect(lan).toBeEnabled()
  })
})

describe('NodeSection LAN change — Change-button parity (#58)', () => {
  function seed(path: string, runningPath: string | null) {
    // Persistent: the select's focus fires a second refresh during the
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
    await user.selectOptions(lan, '10.0.0.5')

    expect(useSessionStore.getState().lanIp).toBe('10.0.0.5')
    expect(useSessionStore.getState().pendingChanges).toBe(true)
  })

  it('does not flag while another card is selected — that is pre-configuration', async () => {
    const user = userEvent.setup()
    seed('/b', '/a')
    render(<NodeSection section="node" />)

    const lan = screen.getByRole('combobox', { name: /network address/i })
    await user.selectOptions(lan, '10.0.0.5')

    expect(useSessionStore.getState().pendingChanges).toBe(false)
  })
})
