import { beforeEach, expect, it, vi } from 'vitest'
import userEvent from '@testing-library/user-event'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import i18n from '@/i18n/config'
import { commands, type DnsServiceStatus } from '@/lib/tauri-bindings'
import { notifications } from '@/lib/notifications'
import { updatePreferences } from '@/lib/preferences'
import type * as PreferencesModule from '@/lib/preferences'
import { useSettingsStore } from '@/store/settings-store'
import { useSessionStore } from '@/store/session-store'
import { DnsSection } from './DnsSection'

vi.mock('@/lib/notifications', () => ({
  notifications: {
    flow: {
      step: vi.fn(),
      succeed: vi.fn(),
      fail: vi.fn(),
      dismiss: vi.fn(),
      message: vi.fn(),
      warn: vi.fn(),
    },
  },
}))
vi.mock('@/lib/preferences', async importOriginal => ({
  ...(await importOriginal<typeof PreferencesModule>()),
  updatePreferences: vi.fn(),
}))

function status(values: Partial<DnsServiceStatus> = {}): DnsServiceStatus {
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
const enabled = () =>
  status({
    registration: 'enabled',
    daemon: true,
    listeners: { udp: true, tcp: true },
  })
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((success, failure) => {
    resolve = success
    reject = failure
  })
  return { promise, resolve, reject }
}
async function ready() {
  const toggle = screen.getByTestId('dns-enabled-switch')
  await waitFor(() => expect(toggle).toBeEnabled())
  return toggle
}

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(commands.dnsServiceStatus).mockResolvedValue(status())
  vi.mocked(commands.dnsServiceEnable).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(commands.dnsServiceDisable).mockResolvedValue({
    status: 'ok',
    data: null,
  })
  vi.mocked(updatePreferences).mockResolvedValue(true)
  useSettingsStore.setState({ dnsEnabledSetting: false })
  useSessionStore.setState({ lanIp: '192.168.1.24' })
})

it('shows an actual initial read instead of reporting unavailable and blocks duplicate work', async () => {
  const pending = deferred<DnsServiceStatus>()
  vi.mocked(commands.dnsServiceStatus).mockReturnValueOnce(pending.promise)
  render(<DnsSection section="dns" />)
  expect(
    screen.getByText(i18n.t('settings.dns.feedback.read'))
  ).toBeInTheDocument()
  expect(
    screen.queryByText(i18n.t('settings.dns.statusUnavailable'))
  ).not.toBeInTheDocument()
  const refresh = screen.getByRole('button', { name: 'Refresh status' })
  expect(refresh).toBeDisabled()
  fireEvent.click(refresh)
  fireEvent.click(screen.getByTestId('dns-enabled-switch'))
  await waitFor(() =>
    expect(commands.dnsServiceStatus).toHaveBeenCalledTimes(1)
  )
  expect(commands.dnsServiceEnable).not.toHaveBeenCalled()
  const id = vi.mocked(notifications.flow.step).mock.calls[0]?.[0]
  await act(async () => pending.resolve(status()))
  expect(notifications.flow.message).toHaveBeenCalledWith(
    id,
    i18n.t('settings.dns.feedback.readDone')
  )
  expect(refresh).toBeEnabled()
})

it('keeps enable pending through native completion, persistence and fresh status', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.dnsServiceEnable>>>()
  vi.mocked(commands.dnsServiceEnable).mockReturnValueOnce(pending.promise)
  render(<DnsSection section="dns" />)
  const toggle = await ready()
  vi.mocked(commands.dnsServiceStatus).mockResolvedValue(enabled())
  fireEvent.click(toggle)
  fireEvent.click(toggle)
  expect(commands.dnsServiceEnable).toHaveBeenCalledTimes(1)
  expect(commands.dnsServiceEnable).toHaveBeenCalledWith(null, '192.168.1.24')
  expect(toggle).toBeDisabled()
  const id = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  await act(async () => pending.resolve({ status: 'ok', data: null }))
  expect(updatePreferences).toHaveBeenCalledWith({ dnsEnabled: true })
  expect(notifications.flow.step).toHaveBeenCalledWith(
    id,
    i18n.t('settings.dns.feedback.read')
  )
  expect(notifications.flow.succeed).toHaveBeenCalledWith(
    id,
    i18n.t('settings.dns.feedback.enabled')
  )
  expect(toggle).toBeEnabled()
})

it('reports pending system approval without claiming DNS is enabled', async () => {
  render(<DnsSection section="dns" />)
  const toggle = await ready()
  vi.mocked(commands.dnsServiceStatus).mockResolvedValue(
    status({ registration: 'requiresApproval' })
  )
  await userEvent.click(toggle)
  expect(notifications.flow.warn).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('settings.dns.status.requiresApproval')
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(
    screen.getByRole('button', { name: 'Open System Settings' })
  ).toBeInTheDocument()
})

it('clears a rejected enable, restores the prior setting and allows a retry', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.dnsServiceEnable>>>()
  vi.mocked(commands.dnsServiceEnable).mockReturnValueOnce(pending.promise)
  render(<DnsSection section="dns" />)
  const toggle = await ready()
  await userEvent.click(toggle)
  const id = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  await act(async () => pending.reject(new Error('Authorization unavailable')))
  expect(notifications.flow.fail).toHaveBeenCalledWith(
    id,
    i18n.t('settings.dns.feedback.changeFailed'),
    'Error: Authorization unavailable'
  )
  expect(toggle).not.toBeChecked()
  expect(toggle).toBeEnabled()
  expect(updatePreferences).not.toHaveBeenCalled()
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})

it('restores the enabled setting after a refused disable rather than saving a false preference', async () => {
  useSettingsStore.setState({ dnsEnabledSetting: true })
  vi.mocked(commands.dnsServiceStatus).mockResolvedValue(enabled())
  vi.mocked(commands.dnsServiceDisable).mockResolvedValueOnce({
    status: 'error',
    error: 'Disable refused',
  })
  render(<DnsSection section="dns" />)
  await userEvent.click(await ready())
  expect(screen.getByTestId('dns-enabled-switch')).toBeChecked()
  expect(notifications.flow.fail).toHaveBeenCalled()
  expect(updatePreferences).not.toHaveBeenCalled()
})

it('distinguishes a failed read from loading and refreshes successfully on retry', async () => {
  vi.mocked(commands.dnsServiceStatus).mockRejectedValueOnce(
    new Error('Read unavailable')
  )
  render(<DnsSection section="dns" />)
  expect(
    await screen.findByText(i18n.t('settings.dns.feedback.readFailed'))
  ).toBeInTheDocument()
  expect(
    screen.queryByText(i18n.t('settings.dns.feedback.read'))
  ).not.toBeInTheDocument()
  await userEvent.click(screen.getByRole('button', { name: 'Refresh status' }))
  expect(notifications.flow.fail).toHaveBeenCalled()
  expect(notifications.flow.message).toHaveBeenCalled()
  expect(
    screen.queryByText(i18n.t('settings.dns.feedback.readFailed'))
  ).not.toBeInTheDocument()
})

it('does not claim success or roll back a native change when the following status read fails', async () => {
  render(<DnsSection section="dns" />)
  const toggle = await ready()
  vi.mocked(commands.dnsServiceStatus).mockRejectedValueOnce(
    new Error('Read unavailable')
  )
  await userEvent.click(toggle)
  expect(toggle).toBeChecked()
  expect(notifications.flow.warn).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('settings.dns.feedback.statusUnknown')
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
  expect(toggle).toBeEnabled()
})

it('keeps a native change distinct from a failed preference save', async () => {
  render(<DnsSection section="dns" />)
  const toggle = await ready()
  vi.mocked(updatePreferences).mockResolvedValueOnce(false)
  vi.mocked(commands.dnsServiceStatus).mockResolvedValue(enabled())
  await userEvent.click(toggle)
  expect(toggle).toBeChecked()
  expect(notifications.flow.warn).toHaveBeenCalledWith(
    expect.any(String),
    i18n.t('settings.dns.feedback.notPersisted')
  )
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})

it('dismisses feedback on closure and makes a reopened panel wait for the dispatched mutation', async () => {
  const pending =
    deferred<Awaited<ReturnType<typeof commands.dnsServiceEnable>>>()
  vi.mocked(commands.dnsServiceEnable).mockReturnValueOnce(pending.promise)
  const first = render(<DnsSection section="dns" />)
  await userEvent.click(await ready())
  const oldId = vi.mocked(notifications.flow.step).mock.calls.at(-1)?.[0]
  first.unmount()
  expect(notifications.flow.dismiss).toHaveBeenCalledWith(oldId)
  render(<DnsSection section="dns" />)
  expect(screen.getByTestId('dns-enabled-switch')).toBeDisabled()
  expect(commands.dnsServiceStatus).toHaveBeenCalledTimes(1)
  vi.mocked(commands.dnsServiceStatus).mockResolvedValue(enabled())
  await act(async () => pending.resolve({ status: 'ok', data: null }))
  await ready()
  expect(commands.dnsServiceEnable).toHaveBeenCalledTimes(1)
  expect(updatePreferences).toHaveBeenCalledWith({ dnsEnabled: true })
  expect(notifications.flow.succeed).not.toHaveBeenCalled()
})
