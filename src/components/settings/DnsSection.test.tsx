import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, type DnsServiceStatus } from '@/lib/tauri-bindings'
import { DnsSection } from './DnsSection'
import { useSettingsStore } from '@/store/settings-store'
import { render } from '@/test/test-utils'

const status = (over: Partial<DnsServiceStatus> = {}): DnsServiceStatus => ({
  registration: 'notRegistered',
  daemon: false,
  plistPresent: true,
  listeners: null,
  bindError: null,
  upstreams: [],
  mapping: null,
  knownDomains: [],
  stats: null,
  ...over,
})

beforeEach(() => {
  vi.clearAllMocks()
  useSettingsStore.setState({
    dnsEnabledSetting: false,
  })
  vi.mocked(commands.dnsServiceStatus).mockResolvedValue(status())
  vi.mocked(commands.dnsServiceEnable).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.dnsServiceDisable).mockResolvedValue({
    status: 'ok',
    data: null,
  })
})

describe('DnsSection (#174)', () => {
  it('renders the daemon status fetched on mount', async () => {
    vi.mocked(commands.dnsServiceStatus).mockResolvedValue(
      status({
        registration: 'enabled',
        daemon: true,
        listeners: { udp: true, tcp: true },
        upstreams: ['223.5.5.5'],
      })
    )
    render(<DnsSection section="dns" />)
    await waitFor(() => {
      expect(screen.getByTestId('dns-registration')).toHaveTextContent(
        'Enabled — restored on login and reboot'
      )
    })
    expect(vi.mocked(commands.dnsServiceStatus)).toHaveBeenCalled()
  })

  it('shows the live performance mapping when the daemon holds one', async () => {
    vi.mocked(commands.dnsServiceStatus).mockResolvedValue(
      status({
        registration: 'enabled',
        daemon: true,
        listeners: { udp: true, tcp: true },
        mapping: {
          domain: 'show.example.org.',
          ip: '192.168.11.31',
          runId: 'app-1-2',
          generation: 3,
          leaseSecondsRemaining: 42,
        },
      })
    )
    render(<DnsSection section="dns" />)
    await waitFor(() => {
      expect(screen.getByTestId('dns-mapping')).toHaveTextContent(
        'show.example.org'
      )
      expect(screen.getByTestId('dns-mapping')).toHaveTextContent(
        '192.168.11.31'
      )
    })
  })

  it('enabling registers through the service, commits the switch and refreshes', async () => {
    const user = userEvent.setup()
    render(<DnsSection section="dns" />)
    await waitFor(() => {
      expect(commands.dnsServiceStatus).toHaveBeenCalled()
    })
    await user.click(screen.getByTestId('dns-enabled-switch'))
    await waitFor(() => {
      expect(vi.mocked(commands.dnsServiceEnable)).toHaveBeenCalled()
    })
    // Upstreams are the App's built-in defaults (null → backend
    // defaults) and the listen address is the session's LAN choice.
    expect(vi.mocked(commands.dnsServiceEnable)).toHaveBeenCalledWith(
      null,
      null
    )
    expect(useSettingsStore.getState().dnsEnabledSetting).toBe(true)
    expect(vi.mocked(commands.savePreferences)).toHaveBeenCalledWith(
      expect.objectContaining({ dnsEnabled: true })
    )
    // The status re-read happens after the toggle completes.
    const calls = vi.mocked(commands.dnsServiceStatus).mock.calls.length
    expect(calls).toBeGreaterThanOrEqual(2)
  })

  it('a failed enable flips the switch back off and never persists', async () => {
    vi.mocked(commands.dnsServiceEnable).mockResolvedValue({
      status: 'error',
      error: 'the system refused the registration',
    })
    const user = userEvent.setup()
    render(<DnsSection section="dns" />)
    await user.click(screen.getByTestId('dns-enabled-switch'))
    await waitFor(() => {
      expect(useSettingsStore.getState().dnsEnabledSetting).toBe(false)
    })
    expect(vi.mocked(commands.savePreferences)).not.toHaveBeenCalledWith(
      expect.objectContaining({ dnsEnabled: true })
    )
  })

  it('a pending approval offers the System Settings recovery path', async () => {
    vi.mocked(commands.dnsServiceStatus).mockResolvedValue(
      status({ registration: 'requiresApproval', daemon: false })
    )
    const user = userEvent.setup()
    render(<DnsSection section="dns" />)
    const button = await screen.findByRole('button', {
      name: 'Open System Settings',
    })
    await user.click(button)
    expect(vi.mocked(commands.dnsServiceOpenSystemSettings)).toHaveBeenCalled()
  })

  it('daemon down renders the unavailable status without an error page', async () => {
    vi.mocked(commands.dnsServiceStatus).mockRejectedValue(
      new Error('connect: refused')
    )
    render(<DnsSection section="dns" />)
    expect(await screen.findByText(/Status unavailable —/)).toBeInTheDocument()
  })
})
