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
    useSessionStore.setState({
      lanIp: null,
      lanAddresses: ['192.168.1.10', '10.0.0.5'],
    })
    render(<NodeSection section="node" />)

    const lan = screen.getByRole('combobox', { name: /network address/i })
    await user.selectOptions(lan, '10.0.0.5')

    expect(useSessionStore.getState().lanIp).toBe('10.0.0.5')
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('shows the hint when no LAN address is known yet', () => {
    useSessionStore.setState({ lanAddresses: [] })
    render(<NodeSection section="node" />)
    const lan = screen.getByRole('combobox', { name: /network address/i })
    expect(lan).toBeDisabled()
    expect(screen.getByTestId('node-hint')).toBeInTheDocument()
  })
})

describe('NodeSection LAN change — Change-button parity (#58)', () => {
  function seed(path: string, runningPath: string | null) {
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
