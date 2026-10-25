import { screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands, type DnsServiceStatus } from '@/lib/tauri-bindings'
import { DnsSection } from './DnsSection'
import { useSettingsStore } from '@/store/settings-store'
import { render } from '@/test/test-utils'
import i18n from '@/i18n/config'

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

  it('collapses normal listener details while keeping service state and permission consequences visible', async () => {
    vi.mocked(commands.dnsServiceStatus).mockResolvedValue(
      status({
        registration: 'enabled',
        daemon: true,
        listeners: { udp: true, tcp: true },
        upstreams: ['223.5.5.5'],
      })
    )
    render(<DnsSection section="dns" />)
    expect(
      await screen.findByText(i18n.t('settings.presentation.running'))
    ).toBeVisible()
    expect(screen.getByTestId('dns-registration')).toBeVisible()
    expect(
      screen.getByText(i18n.t('settings.presentation.dnsPermission'))
    ).toBeVisible()
    const upstream = screen.getByText(/223\.5\.5\.5/)
    expect(upstream).not.toBeVisible()
    await userEvent.click(
      screen.getByText(i18n.t('settings.presentation.dnsDetails'))
    )
    expect(upstream).toBeVisible()
    expect(commands.dnsServiceEnable).not.toHaveBeenCalled()
    expect(commands.dnsServiceDisable).not.toHaveBeenCalled()
  })

  it('keeps a port binding failure and incomplete listener state outside collapsed details', async () => {
    vi.mocked(commands.dnsServiceStatus).mockResolvedValue(
      status({
        registration: 'enabled',
        daemon: true,
        listeners: { udp: false, tcp: true },
        bindError: 'UDP 53 occupied',
      })
    )
    render(<DnsSection section="dns" />)
    expect(await screen.findByTestId('dns-bind-error')).toBeVisible()
    expect(
      screen.getByText(
        i18n.t('settings.dns.listeners', { udp: '—', tcp: 'TCP' })
      )
    ).toBeVisible()
    expect(document.querySelector('details')).not.toHaveAttribute('open')
    await userEvent.click(
      screen.getByRole('button', { name: 'Refresh status' })
    )
    await waitFor(() =>
      expect(commands.dnsServiceStatus).toHaveBeenCalledTimes(2)
    )
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
    expect(screen.getByTestId('dns-mapping')).toBeVisible()
    expect(
      screen.getByText(i18n.t('settings.presentation.dnsMappingScope'))
    ).toBeVisible()
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
    expect(button).toBeVisible()
    expect(document.querySelector('details')).not.toHaveAttribute('open')
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
