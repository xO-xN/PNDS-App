import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import type { AppPreferences } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { HttpsSection } from './HttpsSection'

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((res, rej) => {
    resolve = res
    reject = rej
  })
  return { promise, resolve, reject }
}

/** A stored-certificate fixture the assertions can read. */
const storedSummary = {
  subject: 'show.example.org',
  issuer: 'PNDS Test Intermediate CA',
  sans: ['show.example.org'],
  notBefore: '2026-01-01T00:00:00Z',
  notAfter: '2027-01-01T00:00:00Z',
  daysRemaining: 90,
  fingerprint: 'AA:BB:CC',
  status: 'valid' as const,
}

/**
 * #139: the settings「可信 HTTPS」section — domain/port as normal
 * preferences (invalid values held back from the save queue), the
 * certificate material imported/validated/protected-stored by the
 * backend, expiry reminders, and the next-start hint.
 */
describe('HttpsSection (#139)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    let preferences: AppPreferences = { theme: 'system', language: null }
    vi.mocked(commands.loadPreferences)
      .mockReset()
      .mockImplementation(async () => ({ status: 'ok', data: preferences }))
    vi.mocked(commands.savePreferences)
      .mockReset()
      .mockImplementation(async updated => {
        preferences = updated
        return { status: 'ok', data: null }
      })
    useSettingsStore.setState({
      httpsDomainSetting: '',
      httpsPortSetting: '',
      httpsEnabledSetting: false,
    })
    useSessionStore.getState().resetSession()
    vi.mocked(commands.loadHttpsCertificate).mockResolvedValue({
      status: 'ok',
      data: null,
    })
  })

  it('renders the domain and port rows and the empty material state', async () => {
    render(<HttpsSection section="https" />)

    expect(screen.getByLabelText(/domain/i)).toBeInTheDocument()
    expect(screen.getByLabelText(/https port/i)).toBeInTheDocument()
    await waitFor(() => {
      expect(commands.loadHttpsCertificate).toHaveBeenCalled()
    })
    expect(
      await screen.findByText(/no certificate imported yet/i)
    ).toBeInTheDocument()
    // Nothing modified — the next-start note stays hidden.
    expect(screen.queryByTestId('https-hint')).not.toBeInTheDocument()
  })

  it('commits a valid domain and port on blur, normalized and as numbers', async () => {
    const user = userEvent.setup()
    render(<HttpsSection section="https" />)

    await user.type(screen.getByLabelText(/domain/i), '  Show.Example.ORG. ')
    await user.tab()
    await user.type(screen.getByLabelText(/https port/i), '8443')
    await user.tab()

    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ httpsDomain: 'show.example.org' })
      )
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ httpsPort: 8443 })
      )
    })
  })

  it('holds an invalid domain back from the save queue with a readable error', async () => {
    const user = userEvent.setup()
    render(<HttpsSection section="https" />)

    await user.type(screen.getByLabelText(/domain/i), '192.168.1.10')
    await user.tab()

    expect(await screen.findByTestId('https-domain-error')).toHaveTextContent(
      /real DNS domain/i
    )
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('holds an invalid port back from the save queue', async () => {
    const user = userEvent.setup()
    render(<HttpsSection section="https" />)

    await user.type(screen.getByLabelText(/https port/i), '443')
    await user.tab()

    expect(await screen.findByTestId('https-port-error')).toHaveTextContent(
      /non-privileged/i
    )
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('shows the stored certificate with its expiry and fingerprint', async () => {
    vi.mocked(commands.loadHttpsCertificate).mockResolvedValue({
      status: 'ok',
      data: { summary: storedSummary, problems: [] },
    })
    render(<HttpsSection section="https" />)

    expect(await screen.findByTestId('https-status')).toHaveTextContent(
      /certificate ready/i
    )
    expect(screen.getByText(/show\.example\.org/)).toBeInTheDocument()
    expect(screen.getByText(/AA:BB:CC/)).toBeInTheDocument()
  })

  it('renders the expiring-soon reminder with the remaining days', async () => {
    vi.mocked(commands.loadHttpsCertificate).mockResolvedValue({
      status: 'ok',
      data: {
        summary: {
          ...storedSummary,
          status: 'expiringSoon',
          daysRemaining: 10,
        },
        problems: [],
      },
    })
    render(<HttpsSection section="https" />)

    expect(await screen.findByTestId('https-status')).toHaveTextContent(
      /expiring soon/i
    )
    expect(screen.getByTestId('https-status')).toHaveTextContent(/10 day/)
  })

  it('renders backend problems localized with the English detail underneath', async () => {
    vi.mocked(commands.loadHttpsCertificate).mockResolvedValue({
      status: 'ok',
      data: {
        summary: { ...storedSummary, status: 'wrongDomain' },
        problems: [
          {
            code: 'domainMismatch',
            detail:
              "The certificate does not cover 'renamed.example.org' — it covers: show.example.org.",
          },
        ],
      },
    })
    render(<HttpsSection section="https" />)

    expect(await screen.findByTestId('https-status')).toHaveTextContent(
      /does not cover the configured domain/i
    )
    expect(
      screen.getByText(/it covers: show\.example\.org/)
    ).toBeInTheDocument()
  })

  it('refuses import until the domain is filled, without opening pickers', async () => {
    const user = userEvent.setup()
    const { open } = await import('@tauri-apps/plugin-dialog')
    render(<HttpsSection section="https" />)

    await user.click(screen.getByRole('button', { name: /^import$/i }))

    expect(
      await screen.findByText(/fill in the domain first/i)
    ).toBeInTheDocument()
    expect(open).not.toHaveBeenCalled()
    expect(commands.importHttpsCertificate).not.toHaveBeenCalled()
  })

  it('imports through both pickers and shows the resulting summary', async () => {
    const user = userEvent.setup()
    const { open } = await import('@tauri-apps/plugin-dialog')
    vi.mocked(open)
      .mockResolvedValueOnce('/certs/fullchain.pem')
      .mockResolvedValueOnce('/certs/privkey.pem')
    vi.mocked(commands.importHttpsCertificate).mockResolvedValue({
      status: 'ok',
      data: { summary: storedSummary, problems: [] },
    })
    useSettingsStore.setState({ httpsDomainSetting: 'show.example.org' })
    render(<HttpsSection section="https" />)

    await user.click(screen.getByRole('button', { name: /^import$/i }))

    await waitFor(() => {
      expect(commands.importHttpsCertificate).toHaveBeenCalledWith(
        'show.example.org',
        '/certs/fullchain.pem',
        '/certs/privkey.pem'
      )
    })
    expect(await screen.findByTestId('https-status')).toHaveTextContent(
      /certificate ready/i
    )
  })

  it('keeps the previous state visible when import is refused', async () => {
    const user = userEvent.setup()
    const { open } = await import('@tauri-apps/plugin-dialog')
    vi.mocked(open)
      .mockResolvedValueOnce('/certs/fullchain.pem')
      .mockResolvedValueOnce('/certs/privkey.pem')
    vi.mocked(commands.importHttpsCertificate).mockResolvedValue({
      status: 'ok',
      data: {
        summary: null,
        problems: [
          {
            code: 'keyMismatch',
            detail:
              'The private key does not match the certificate — pick the key issued with this certificate.',
          },
        ],
      },
    })
    // A certificate is already stored; the refusal must not wipe its
    // display — storage keeps it, so the section keeps showing it.
    vi.mocked(commands.loadHttpsCertificate).mockResolvedValue({
      status: 'ok',
      data: { summary: storedSummary, problems: [] },
    })
    useSettingsStore.setState({ httpsDomainSetting: 'show.example.org' })
    render(<HttpsSection section="https" />)

    await user.click(await screen.findByRole('button', { name: /^import$/i }))

    // Both the localized message and the backend's English detail render.
    const matches = await screen.findAllByText(
      /private key does not match the certificate/i
    )
    expect(matches.length).toBeGreaterThanOrEqual(2)
    // The stored certificate's summary survives the refusal. A refused
    // import changed nothing, so the next-start note stays down.
    expect(await screen.findByTestId('https-status')).toHaveTextContent(
      /certificate ready/i
    )
    expect(screen.queryByTestId('https-hint')).not.toBeInTheDocument()
  })

  it('clears the stored material', async () => {
    const user = userEvent.setup()
    vi.mocked(commands.loadHttpsCertificate).mockResolvedValue({
      status: 'ok',
      data: { summary: storedSummary, problems: [] },
    })
    render(<HttpsSection section="https" />)

    await user.click(await screen.findByRole('button', { name: /clear/i }))

    await waitFor(() => {
      expect(commands.clearHttpsCertificate).toHaveBeenCalled()
    })
    await waitFor(() => {
      expect(
        screen.getByText(/no certificate imported yet/i)
      ).toBeInTheDocument()
    })
    // Clearing is a material change — the next-start note comes up.
    expect(screen.getByTestId('https-hint')).toBeInTheDocument()
  })

  it('reveals the next-start note only after a row is modified', async () => {
    const user = userEvent.setup()
    render(<HttpsSection section="https" />)

    expect(screen.queryByTestId('https-hint')).not.toBeInTheDocument()

    await user.type(screen.getByLabelText(/domain/i), 'show.example.org')
    expect(screen.getByTestId('https-hint')).toHaveTextContent(
      /next project start/i
    )
  })

  it('names the LAN address the router DNS should point at', () => {
    useSessionStore.setState({ lanIp: '192.168.1.10' })
    render(<HttpsSection section="https" />)

    expect(screen.getByText(/192\.168\.1\.10/)).toBeInTheDocument()
  })

  it('seeds the enable switch from the store (#140)', () => {
    useSettingsStore.setState({ httpsEnabledSetting: true })
    render(<HttpsSection section="https" />)
    expect(screen.getByTestId('https-enabled-switch')).toHaveProperty(
      'dataset.state',
      'checked'
    )
  })

  it('the enable switch commits httpsEnabled and reveals the next-start hint (#140)', async () => {
    const user = userEvent.setup()
    render(<HttpsSection section="https" />)

    await user.click(screen.getByTestId('https-enabled-switch'))
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ httpsEnabled: true })
      )
    })
    expect(screen.getByTestId('https-hint')).toBeInTheDocument()
  })
})

describe('HTTPS preparation ordering and recovery', () => {
  beforeEach(async () => {
    await new Promise(resolve => setTimeout(resolve, 0))
    vi.clearAllMocks()
    useSettingsStore.setState({
      httpsDomainSetting: 'show.example.org',
      httpsPortSetting: '',
      httpsEnabledSetting: false,
    })
    vi.mocked(commands.loadPreferences)
      .mockReset()
      .mockResolvedValue({
        status: 'ok',
        data: {
          theme: 'system',
          language: null,
          httpsDomain: 'show.example.org',
        },
      })
    vi.mocked(commands.savePreferences)
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: null })
    vi.mocked(commands.loadHttpsCertificate)
      .mockReset()
      .mockResolvedValue({
        status: 'ok',
        data: { summary: storedSummary, problems: [] },
      })
    vi.mocked(commands.importHttpsCertificate)
      .mockReset()
      .mockResolvedValue({
        status: 'ok',
        data: {
          summary: { ...storedSummary, fingerprint: 'NEW:CERT' },
          problems: [],
        },
      })
    vi.mocked(commands.clearHttpsCertificate)
      .mockReset()
      .mockResolvedValue({ status: 'ok', data: true })
    const { open } = await import('@tauri-apps/plugin-dialog')
    vi.mocked(open)
      .mockReset()
      .mockResolvedValueOnce('/certs/fullchain.pem')
      .mockResolvedValueOnce('/certs/privkey.pem')
  })

  it('keeps the imported certificate when the initial read returns late', async () => {
    const late =
      deferred<Awaited<ReturnType<typeof commands.loadHttpsCertificate>>>()
    vi.mocked(commands.loadHttpsCertificate).mockReturnValueOnce(late.promise)
    render(<HttpsSection section="https" />)
    await waitFor(() =>
      expect(commands.loadHttpsCertificate).toHaveBeenCalledOnce()
    )
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    expect(await screen.findByText('NEW:CERT')).toBeInTheDocument()
    await act(async () =>
      late.resolve({
        status: 'ok',
        data: { summary: storedSummary, problems: [] },
      })
    )
    expect(screen.getByText('NEW:CERT')).toBeInTheDocument()
    expect(screen.queryByText('AA:BB:CC')).not.toBeInTheDocument()
  })

  it('locks import and clear from the first picker, and unlocks on cancellation', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picker = deferred<string | null>()
    vi.mocked(open).mockReset().mockReturnValueOnce(picker.promise)
    render(<HttpsSection section="https" />)
    await screen.findByTestId('https-status')
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    expect(screen.getByRole('button', { name: /validating/i })).toBeDisabled()
    expect(screen.getByRole('button', { name: /clear/i })).toBeDisabled()
    expect(screen.getByLabelText(/domain/i)).toBeDisabled()
    fireEvent.click(screen.getByRole('button', { name: /validating/i }))
    await act(async () => picker.resolve(null))
    expect(open).toHaveBeenCalledOnce()
    expect(screen.getByRole('button', { name: /^import$/i })).toBeEnabled()
    expect(screen.getByRole('button', { name: /clear/i })).toBeEnabled()
    expect(commands.importHttpsCertificate).not.toHaveBeenCalled()
  })

  it.each(['first picker', 'second picker', 'import'] as const)(
    'recovers after a rejected %s and preserves the stored facts',
    async stage => {
      const { open } = await import('@tauri-apps/plugin-dialog')
      if (stage === 'first picker')
        vi.mocked(open)
          .mockReset()
          .mockRejectedValueOnce(new Error('picker unavailable'))
      else if (stage === 'second picker')
        vi.mocked(open)
          .mockReset()
          .mockResolvedValueOnce('/certs/fullchain.pem')
          .mockRejectedValueOnce(new Error('picker unavailable'))
      else
        vi.mocked(commands.importHttpsCertificate).mockRejectedValueOnce(
          new Error('IPC unavailable')
        )
      render(<HttpsSection section="https" />)
      await screen.findByTestId('https-status')
      fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
      expect(await screen.findByText(/could not import/i)).toBeInTheDocument()
      expect(screen.getByText('AA:BB:CC')).toBeInTheDocument()
      expect(screen.getByRole('button', { name: /^import$/i })).toBeEnabled()
      expect(screen.getByRole('button', { name: /clear/i })).toBeEnabled()
    }
  )

  it('recovers after a rejected clear without claiming the certificate was removed', async () => {
    vi.mocked(commands.clearHttpsCertificate).mockRejectedValueOnce(
      new Error('IPC unavailable')
    )
    render(<HttpsSection section="https" />)
    await screen.findByTestId('https-status')
    fireEvent.click(screen.getByRole('button', { name: /clear/i }))
    expect(await screen.findByText(/could not clear/i)).toBeInTheDocument()
    expect(screen.getByText('AA:BB:CC')).toBeInTheDocument()
    expect(screen.queryByTestId('https-hint')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: /clear/i })).toBeEnabled()
  })

  it('waits for a successful domain save before revalidating the summary in the open panel', async () => {
    const save =
      deferred<Awaited<ReturnType<typeof commands.savePreferences>>>()
    render(<HttpsSection section="https" />)
    await screen.findByTestId('https-status')
    vi.mocked(commands.savePreferences).mockReturnValueOnce(save.promise)
    fireEvent.change(screen.getByLabelText(/domain/i), {
      target: { value: 'other.example.org' },
    })
    fireEvent.blur(screen.getByLabelText(/domain/i))
    await waitFor(() => expect(commands.savePreferences).toHaveBeenCalledOnce())
    expect(commands.loadHttpsCertificate).toHaveBeenCalledOnce()
    expect(screen.queryByText(/^certificate ready$/i)).not.toBeInTheDocument()
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        language: null,
        httpsDomain: 'other.example.org',
      },
    })
    vi.mocked(commands.loadHttpsCertificate).mockResolvedValue({
      status: 'ok',
      data: {
        summary: { ...storedSummary, status: 'wrongDomain' },
        problems: [
          {
            code: 'domainMismatch',
            detail: 'other.example.org is not covered',
          },
        ],
      },
    })
    await act(async () => save.resolve({ status: 'ok', data: null }))
    await waitFor(() =>
      expect(screen.getByTestId('https-status')).toHaveTextContent(
        /does not cover the configured domain/i
      )
    )
    expect(commands.loadHttpsCertificate).toHaveBeenCalledTimes(2)
  })

  it('does not revalidate or display readiness for a domain whose save failed', async () => {
    render(<HttpsSection section="https" />)
    await screen.findByTestId('https-status')
    vi.mocked(commands.savePreferences).mockResolvedValueOnce({
      status: 'error',
      error: 'disk full',
    })
    fireEvent.change(screen.getByLabelText(/domain/i), {
      target: { value: 'other.example.org' },
    })
    fireEvent.blur(screen.getByLabelText(/domain/i))
    expect(await screen.findByText(/could not save/i)).toBeInTheDocument()
    expect(commands.loadHttpsCertificate).toHaveBeenCalledOnce()
    expect(screen.getByText('AA:BB:CC')).toBeInTheDocument()
    expect(screen.queryByText(/^certificate ready$/i)).not.toBeInTheDocument()
  })

  it('stops the picker chain after the panel unmounts', async () => {
    const { open } = await import('@tauri-apps/plugin-dialog')
    const picker = deferred<string | null>()
    vi.mocked(open).mockReset().mockReturnValueOnce(picker.promise)
    const view = render(<HttpsSection section="https" />)
    await screen.findByTestId('https-status')
    fireEvent.click(screen.getByRole('button', { name: /^import$/i }))
    await waitFor(() => expect(open).toHaveBeenCalledOnce())
    view.unmount()
    await act(async () => picker.resolve('/certs/fullchain.pem'))
    expect(open).toHaveBeenCalledOnce()
    expect(commands.importHttpsCertificate).not.toHaveBeenCalled()
  })

  it('settles a rejected initial read with a visible retryable error', async () => {
    vi.mocked(commands.loadHttpsCertificate).mockRejectedValueOnce(
      new Error('IPC unavailable')
    )
    render(<HttpsSection section="https" />)
    expect(await screen.findByText(/could not read/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /^import$/i })).toBeEnabled()
  })
})
