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
import i18n from '@/i18n/config'
import { commands, type DnsServiceStatus } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useHostEntryStore } from '@/store/host-entry-store'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { PerformerAccessSection } from './PerformerAccessSection'

function dnsStatus(values: Partial<DnsServiceStatus> = {}): DnsServiceStatus {
  return {
    registration: 'notRegistered',
    daemon: false,
    plistPresent: true,
    listeners: null,
    bindError: null,
    upstreams: [],
    mapping: null,
    knownDomains: [],
    stats: null,
    ...values,
  }
}

function disclosure(section: string) {
  const element = document.getElementById(`settings-access-${section}`)
  if (!(element instanceof HTMLDetailsElement)) throw new Error(section)
  return element
}

function summary(section: string) {
  const element = disclosure(section).querySelector('summary')
  if (!element) throw new Error(section)
  return element
}

beforeEach(() => {
  vi.clearAllMocks()
  useSettingsStore.setState({
    focusSection: 'access',
    settingsOpen: true,
    httpsEnabledSetting: false,
    httpsDomainSetting: '',
    httpsPortSetting: '',
    dnsEnabledSetting: false,
  })
  useCreationStore.setState({ active: false, workspace: null })
  useSessionStore.getState().resetSession()
  useProjectStore.setState({
    currentProject: null,
    pendingPreflightPath: null,
    failedPreflightPath: null,
  })
  useHostEntryStore.setState({
    snapshot: { status: 'unbound', url: null, error: null, portChanged: false },
  })
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: { theme: 'system', language: null },
  })
  vi.mocked(commands.savePreferences).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.loadHttpsCertificate).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.dnsServiceStatus).mockResolvedValue(dnsStatus())
  vi.mocked(commands.checkPortStatus).mockImplementation(async port => ({
    status: 'ok',
    data: { port, occupant: null, managedByApp: false, runningProject: null },
  }))
})

it('does not query or change unvisited services when opening the access page', () => {
  render(<PerformerAccessSection section="access" />)
  for (const section of ['https', 'dns', 'ports']) {
    expect(disclosure(section)).not.toHaveAttribute('open')
    expect(summary(section)).toHaveTextContent(i18n.t('settings.access.unread'))
  }
  expect(commands.loadHttpsCertificate).not.toHaveBeenCalled()
  expect(commands.dnsServiceStatus).not.toHaveBeenCalled()
  expect(commands.checkPortStatus).not.toHaveBeenCalled()
  expect(commands.syncHostEntry).not.toHaveBeenCalled()
  expect(commands.startProject).not.toHaveBeenCalled()
})

it.each(['https', 'dns', 'ports'] as const)(
  'opens and reads only the legacy %s destination',
  async section => {
    useSettingsStore.setState({ focusSection: section })
    render(<PerformerAccessSection section="access" />)
    expect(disclosure(section)).toHaveAttribute('open')
    for (const other of ['https', 'dns', 'ports']) {
      if (other !== section)
        expect(disclosure(other)).not.toHaveAttribute('open')
    }
    await waitFor(() => {
      const command = {
        https: commands.loadHttpsCertificate,
        dns: commands.dnsServiceStatus,
        ports: commands.checkPortStatus,
      }[section]
      expect(command).toHaveBeenCalled()
    })
  }
)

it('keeps an invalid HTTPS draft and its real warning mounted when collapsed', async () => {
  const user = userEvent.setup()
  render(<PerformerAccessSection section="access" />)
  await user.click(summary('https'))
  const domain = await screen.findByLabelText('Domain')
  fireEvent.change(domain, { target: { value: '192.168.1.1' } })
  fireEvent.blur(domain)
  await waitFor(() => expect(domain).toHaveAttribute('aria-invalid', 'true'))
  expect(summary('https')).toHaveTextContent(
    i18n.t('settings.https.domainInvalid')
  )
  await user.click(summary('https'))
  expect(disclosure('https')).not.toHaveAttribute('open')
  expect(domain).toBeInTheDocument()
  await user.click(summary('https'))
  expect(screen.getByLabelText('Domain')).toBe(domain)
  expect(domain).toHaveValue('192.168.1.1')
  expect(commands.loadHttpsCertificate).toHaveBeenCalledTimes(1)
  expect(commands.savePreferences).not.toHaveBeenCalled()
})

it('retains a pending DNS operation through collapse and reports approval rather than readiness', async () => {
  const user = userEvent.setup()
  let complete!: () => void
  vi.mocked(commands.dnsServiceEnable).mockReturnValueOnce(
    new Promise(resolve => {
      complete = () => resolve({ status: 'ok', data: null })
    })
  )
  render(<PerformerAccessSection section="access" />)
  await user.click(summary('dns'))
  const toggle = await screen.findByTestId('dns-enabled-switch')
  await waitFor(() => expect(toggle).toBeEnabled())
  await user.click(toggle)
  expect(toggle).toBeDisabled()
  await user.click(summary('dns'))
  expect(toggle).toBeInTheDocument()
  vi.mocked(commands.dnsServiceStatus).mockResolvedValue(
    dnsStatus({ registration: 'requiresApproval' })
  )
  await act(async () => complete())
  await waitFor(() => expect(toggle).toBeEnabled())
  expect(disclosure('dns')).not.toHaveAttribute('open')
  expect(summary('dns')).toHaveTextContent(
    i18n.t('settings.dns.status.requiresApproval')
  )
  expect(summary('dns').querySelector('[data-tone="warning"]')).toBeTruthy()
  await user.click(summary('dns'))
  expect(screen.getByTestId('dns-enabled-switch')).toBe(toggle)
  expect(commands.dnsServiceEnable).toHaveBeenCalledTimes(1)
  expect(commands.dnsServiceStatus).toHaveBeenCalledTimes(2)
})

it('navigates between legacy sections without remounting previously visited content', async () => {
  useSettingsStore.setState({ focusSection: 'https' })
  render(<PerformerAccessSection section="access" />)
  const domain = screen.getByLabelText('Domain')
  await waitFor(() =>
    expect(commands.loadHttpsCertificate).toHaveBeenCalledOnce()
  )
  act(() => useSettingsStore.setState({ focusSection: 'dns' }))
  await screen.findByTestId('dns-enabled-switch')
  expect(disclosure('dns')).toHaveAttribute('open')
  expect(disclosure('https')).toHaveAttribute('open')
  act(() => useSettingsStore.setState({ focusSection: 'access' }))
  expect(screen.getByLabelText('Domain')).toBe(domain)
  expect(disclosure('https')).toHaveAttribute('open')
  expect(commands.loadHttpsCertificate).toHaveBeenCalledOnce()
  act(() => useSettingsStore.setState({ focusSection: 'general' }))
  act(() => useSettingsStore.setState({ focusSection: 'access' }))
  expect(disclosure('https')).toHaveAttribute('open')
  expect(disclosure('dns')).toHaveAttribute('open')
  expect(screen.getByLabelText('Domain')).toBe(domain)
})

it('reports inspected port conflicts and requires revealing the exact process before releasing', async () => {
  const occupant = {
    pid: 2468,
    name: 'node',
    commandLine: 'node /demo/server.mjs --port 6868',
    startedAt: '100:12',
  }
  vi.mocked(commands.checkPortStatus).mockImplementation(async port => ({
    status: 'ok',
    data: {
      port,
      occupant: port === 6868 ? occupant : null,
      managedByApp: false,
      runningProject: null,
    },
  }))
  const user = userEvent.setup()
  render(<PerformerAccessSection section="access" />)
  await user.click(summary('ports'))
  await waitFor(() =>
    expect(summary('ports')).toHaveTextContent(
      i18n.t('settings.access.portsConflict')
    )
  )
  expect(screen.getByRole('button', { name: 'Release' })).not.toBeVisible()
  await user.click(screen.getByText('Process details'))
  await user.click(screen.getByRole('button', { name: 'Release' }))
  const confirmation = screen.getByRole('alertdialog')
  expect(confirmation).toHaveTextContent(occupant.commandLine)
  expect(commands.releasePort).not.toHaveBeenCalled()
  await user.click(
    within(confirmation).getByRole('button', { name: 'Release' })
  )
  await waitFor(() =>
    expect(commands.releasePort).toHaveBeenCalledWith(6868, occupant)
  )
})
