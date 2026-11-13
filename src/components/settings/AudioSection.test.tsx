import { act, render, screen, waitFor, within } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { toast } from 'sonner'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { useCreationStore } from '@/store/creation-store'
import i18n from '@/i18n/config'
import { AudioSection } from './AudioSection'
import type { Manifest, SessionSnapshot } from '@/lib/tauri-bindings'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}))

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'inarticulate-iii',
  name: 'Inarticulate III',
  version: '0.1.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'internal',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: ['supercollider/synthdefs/inarticulate-iii.scsyndef'],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

/** A 16-channel project: needs 16 device channels to be lossless. */
const manifest16: Manifest = {
  ...manifest,
  audio: { ...manifest.audio, outputChannels: 16 },
}

/** §6.3 fixture: a 2ch default device + a 16ch interface. */
const deviceList = {
  status: 'ok' as const,
  data: {
    devices: [
      { name: 'Mac mini Speakers', isDefault: true, maxOutputChannels: 2 },
      { name: 'BlackHole 16ch', isDefault: false, maxOutputChannels: 16 },
    ],
    sampleRate: 48000,
  },
}

async function applyAudio(overrides: Partial<SessionSnapshot> = {}) {
  const result = await commands.getSessionState()
  if (result.status !== 'ok') throw new Error('Expected a session snapshot')
  const snapshot: SessionSnapshot = {
    ...result.data,
    status: 'ready',
    projectPath: '/p',
    audioMode: 'internal',
    outputDevice: 'BlackHole 16ch',
    appliedSampleRate: 48000,
    ...overrides,
  }
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/p',
    latestSnapshot: snapshot,
  })
  return snapshot
}

/**
 * #58: the output device moved from the sidebar settings card into the
 * settings Audio section — the §6.3/§7.6 display contract travels intact
 * (channel counts, greyed-but-selectable loss entries, the closed
 * trigger's red dot), joined to the sample rate's next-start semantics
 * (editable even while a session runs; the running session keeps its
 * spawn-time configuration).
 */
describe('AudioSection output device (#58)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(commands.listOutputDevices).mockResolvedValue(deviceList)
    vi.mocked(commands.listSupportedSampleRates).mockResolvedValue([48000])
    useProjectStore.setState({
      currentProject: { path: '/p', manifest: manifest16 },
      recentProjectPaths: ['/p'],
      preflightStatus: 'ready',
      preflightError: null,
    })
    useSettingsStore.setState({ sampleRateSetting: 48000 })
    useCreationStore.setState({ active: false })
    useSessionStore.getState().resetSession()
    useSessionStore.setState({
      outputDevice: 'System default',
      latestSnapshot: null,
    })
  })

  it('marks a 16ch project’s 2ch device as greyed-but-selectable with the red loss text (§6.3)', async () => {
    const user = userEvent.setup()
    render(<AudioSection section="audio" />)

    await user.click(
      await screen.findByRole('combobox', { name: /output device/i })
    )
    const option = await screen.findByRole('option', {
      name: /^Mac mini Speakers/,
    })
    expect(option.className).toContain('opacity-40')
    expect(withinText(option, '16ch → 2ch')).toBe(true)
    // Enough-channels device shows the bare count, no loss text.
    const enough = screen.getByRole('option', { name: /BlackHole 16ch/ })
    expect(enough.className).not.toContain('opacity-40')
    expect(withinText(enough, '16ch → 2ch')).toBe(false)
    expect(withinText(enough, '16ch')).toBe(true)
  })

  it('shows the persistent loss hint on a channel-poor selection, with no toast (§6.3)', async () => {
    const user = userEvent.setup()
    render(<AudioSection section="audio" />)

    await user.click(
      await screen.findByRole('combobox', { name: /output device/i })
    )
    await user.click(
      await screen.findByRole('option', { name: /^Mac mini Speakers/ })
    )

    const hint = screen.getByTestId('device-insufficient-hint')
    expect(hint).toHaveTextContent('16ch → 2ch')
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.warning).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
  })

  it('shows no loss hint when the device has enough channels', async () => {
    const user = userEvent.setup()
    render(<AudioSection section="audio" />)

    await user.click(
      await screen.findByRole('combobox', { name: /output device/i })
    )
    await user.click(
      await screen.findByRole('option', { name: /BlackHole 16ch/ })
    )

    expect(
      screen.queryByTestId('device-insufficient-hint')
    ).not.toBeInTheDocument()
  })

  it('persists the choice and falls back to the system default when a saved device vanishes (§6.3)', async () => {
    const user = userEvent.setup()
    useSessionStore.setState({ outputDevice: 'Gone Interface' })

    const mounted = render(<AudioSection section="audio" />)
    await waitFor(() => {
      expect(useSessionStore.getState().outputDevice).toBe('System default')
    })
    expect(toast.warning).toHaveBeenCalledExactlyOnceWith(
      'Output device unavailable',
      {
        description:
          'Saved output device "Gone Interface" is not available; using the system default.',
      }
    )
    expect(toast.info).not.toHaveBeenCalled()
    expect(toast.error).not.toHaveBeenCalled()
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ outputDevice: null })
      )
    })

    // A fresh pick persists as its own preference.
    await user.click(screen.getByRole('combobox', { name: /output device/i }))
    await user.click(
      await screen.findByRole('option', { name: /BlackHole 16ch/ })
    )
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ outputDevice: 'BlackHole 16ch' })
      )
    })
    mounted.unmount()
    useSessionStore.setState({ outputDevice: 'Gone Interface' })
    render(<AudioSection section="audio" />)
    await waitFor(() =>
      expect(commands.listOutputDevices).toHaveBeenCalledTimes(2)
    )
    expect(toast.warning).toHaveBeenCalledOnce()
  })

  it('enumerates at the effective sample rate and follows a rate change', async () => {
    render(<AudioSection section="audio" />)
    await waitFor(() => {
      expect(commands.listOutputDevices).toHaveBeenCalledWith(48000)
    })

    useSettingsStore.setState({ sampleRateSetting: 96000 })
    await waitFor(() => {
      expect(commands.listOutputDevices).toHaveBeenCalledWith(96000)
    })
  })

  it('shows only changed fields against actual Internal audio and preserves pending saves', async () => {
    const user = userEvent.setup()
    vi.mocked(commands.listSupportedSampleRates).mockResolvedValue([
      48000, 96000,
    ])
    const snapshot = await applyAudio()
    render(<AudioSection section="audio" />)
    const device = await screen.findByRole('combobox', {
      name: /output device/i,
    })
    expect(device).toBeEnabled()
    expect(screen.getByLabelText('Sample rate')).toBeEnabled()
    expect(
      await screen.findByText('Currently using BlackHole 16ch')
    ).toBeVisible()
    expect(screen.queryByText('Currently using 48 kHz')).not.toBeInTheDocument()
    expect(
      screen.getByText('Changes apply at the next project start.')
    ).toBeVisible()
    expect(document.querySelector('.desktop-applied')).toBeNull()

    await user.click(screen.getByLabelText('Sample rate'))
    await user.click(await screen.findByRole('option', { name: '96 kHz' }))
    expect(screen.getByText('Currently using 48 kHz')).toBeVisible()
    expect(useSessionStore.getState().pendingChanges).toBe(true)
    expect(useSessionStore.getState().latestSnapshot).toBe(snapshot)
    await waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ sampleRate: 96000 })
      )
    )

    await user.click(device)
    await user.click(
      await screen.findByRole('option', { name: /BlackHole 16ch/ })
    )
    expect(
      screen.queryByText('Currently using BlackHole 16ch')
    ).not.toBeInTheDocument()
    expect(screen.getByText('Currently using 48 kHz')).toBeVisible()
    await waitFor(() =>
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ outputDevice: 'BlackHole 16ch' })
      )
    )
    await user.click(screen.getByLabelText('Sample rate'))
    await user.click(await screen.findByRole('option', { name: '48 kHz' }))
    expect(screen.queryByText(/Currently using/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('Changes apply at the next project start.')
    ).not.toBeInTheDocument()
  })

  it('resolves the system default before comparing it with the actual running device', async () => {
    await applyAudio({ outputDevice: 'Mac mini Speakers' })
    render(<AudioSection section="audio" />)
    await waitFor(() =>
      expect(screen.getByTestId('device-insufficient-hint')).toBeVisible()
    )
    expect(screen.queryByText(/Currently using/)).not.toBeInTheDocument()
    expect(
      screen.queryByText('Changes apply at the next project start.')
    ).not.toBeInTheDocument()
    expect(screen.getByLabelText('Output device')).toHaveTextContent(
      'System default · Mac mini Speakers'
    )
  })

  it('uses the running channel plan while another project is selected', async () => {
    await applyAudio({
      projectPath: '/other-running-project',
      channelPlan: {
        projectChannels: 2,
        deviceChannels: 16,
        bridgedChannels: 2,
        privateBusStart: 2,
      },
    })
    render(<AudioSection section="audio" />)
    expect(screen.getByText('Internal · 2 channels')).toBeVisible()
    expect(screen.queryByText('Internal · 16 channels')).not.toBeInTheDocument()
  })

  it('does not invent a default-device mismatch while enumeration is pending or fails', async () => {
    await applyAudio()
    let finish!: (
      value: Awaited<ReturnType<typeof commands.listOutputDevices>>
    ) => void
    vi.mocked(commands.listOutputDevices).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    render(<AudioSection section="audio" />)
    expect(screen.queryByText(/Currently using/)).not.toBeInTheDocument()
    await act(async () => finish({ status: 'error', error: 'Unavailable' }))
    expect(screen.queryByText(/Currently using/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Output device')).toBeEnabled()
  })

  it.each(['external', 'none'] as const)(
    'keeps Internal preferences editable without claiming applied device values for %s',
    async audioMode => {
      await applyAudio({ audioMode })
      useSettingsStore.setState({ sampleRateSetting: 96000 })
      render(<AudioSection section="audio" />)
      await waitFor(() => expect(commands.listOutputDevices).toHaveBeenCalled())
      expect(screen.queryByText(/Currently using/)).not.toBeInTheDocument()
      expect(
        screen.queryByText('Changes apply at the next project start.')
      ).not.toBeInTheDocument()
      expect(
        screen.getByText(i18n.t('settings.presentation.internalPreferences'))
      ).toBeVisible()
      expect(screen.getByLabelText('Output device')).toBeEnabled()
      expect(screen.getByLabelText('Sample rate')).toBeEnabled()
    }
  )

  it.each(['idle', 'starting', 'stopping', 'error'] as const)(
    'does not present an old ready snapshot as current audio during %s',
    async sessionStatus => {
      await applyAudio()
      useSessionStore.setState({ sessionStatus })
      render(<AudioSection section="audio" />)
      await waitFor(() =>
        expect(screen.getByTestId('device-insufficient-hint')).toBeVisible()
      )
      expect(screen.queryByText(/Currently using/)).not.toBeInTheDocument()
      expect(
        screen.queryByText('Changes apply at the next project start.')
      ).not.toBeInTheDocument()
    }
  )

  it('keeps compact and full controls uniquely labelled when both are mounted', async () => {
    render(
      <>
        <AudioSection section="audio" />
        <AudioSection section="audio" compact />
      </>
    )
    const sections = await screen.findAllByRole('region', { name: 'Audio' })
    expect(sections).toHaveLength(2)
    const controls = sections.map(section =>
      within(section).getByRole('combobox', { name: 'Output device' })
    )
    expect(controls[0]?.id).not.toBe(controls[1]?.id)
    const ids = [...document.querySelectorAll('[id]')].map(
      element => element.id
    )
    expect(new Set(ids).size).toBe(ids.length)
    for (const section of sections)
      expect(within(section).getByLabelText('Sample rate')).toBeEnabled()
  })

  it('shows applied audio separately from the compact next-start controls', async () => {
    await applyAudio()
    useSettingsStore.setState({ sampleRateSetting: 96000 })
    const { container } = render(
      <>
        <AudioSection section="audio" compact />
        <AudioSection section="audio" />
      </>
    )
    await waitFor(() => expect(commands.listOutputDevices).toHaveBeenCalled())
    const compact = container.querySelector('[data-compact]')
    if (!(compact instanceof HTMLElement))
      throw new Error('Missing compact Audio section')
    expect(compact).toHaveAccessibleName('Audio')
    expect(within(compact).getAllByRole('combobox')).toHaveLength(2)
    expect(within(compact).getByLabelText('Output device')).toBeEnabled()
    expect(within(compact).getByLabelText('Sample rate')).toHaveTextContent(
      '96 kHz'
    )
    const labels = within(compact).getAllByRole('term')
    expect(labels[0]).toHaveTextContent('Applied output device')
    expect(labels[1]).toHaveTextContent('Applied sample rate')
    const values = within(compact).getAllByRole('definition')
    expect(values[0]).toHaveTextContent('BlackHole 16ch')
    expect(values[1]).toHaveTextContent('48 kHz')
    expect(within(compact).queryByRole('heading')).not.toBeInTheDocument()
    expect(
      compact.querySelector('.settings-runtime, .settings-field-difference')
    ).toBeNull()
    expect(
      within(compact).queryByTestId('device-insufficient-hint')
    ).not.toBeInTheDocument()
    expect(within(compact).getByLabelText('Output device')).not.toHaveAttribute(
      'aria-describedby'
    )
    expect(within(compact).getByLabelText('Sample rate')).not.toHaveAttribute(
      'aria-describedby'
    )
    expect(screen.getByRole('heading', { name: 'Audio' })).toBeVisible()
    expect(screen.getByText('Currently using BlackHole 16ch')).toBeVisible()
    expect(screen.getByText('Currently using 48 kHz')).toBeVisible()
    expect(
      screen.getAllByText('Changes apply at the next project start.')
    ).toHaveLength(2)

    act(() => useSessionStore.setState({ sessionStatus: 'stopping' }))
    expect(within(compact).queryByRole('definition')).not.toBeInTheDocument()
  })

  it('preserves real device and rate saving in the compact section without restarting audio', async () => {
    const applied = await applyAudio()
    vi.mocked(commands.listSupportedSampleRates).mockResolvedValue([
      48000, 96000,
    ])
    render(<AudioSection section="audio" compact />)
    const user = userEvent.setup()
    await user.click(screen.getByLabelText('Output device'))
    await user.click(
      await screen.findByRole('option', { name: /BlackHole 16ch/ })
    )
    await user.click(screen.getByLabelText('Sample rate'))
    await user.click(await screen.findByRole('option', { name: '96 kHz' }))
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ outputDevice: 'BlackHole 16ch' })
      )
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ sampleRate: 96000 })
      )
    })
    expect(useSessionStore.getState().outputDevice).toBe('BlackHole 16ch')
    expect(useSettingsStore.getState().sampleRateSetting).toBe(96000)
    expect(useSessionStore.getState().latestSnapshot).toBe(applied)
    expect(useSessionStore.getState().pendingChanges).toBe(true)
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    const values = screen.getAllByRole('definition')
    expect(values[0]).toHaveTextContent('BlackHole 16ch')
    expect(values[1]).toHaveTextContent('48 kHz')
  })

  it('an enumeration failure leaves a safe empty list — Load is never gated by it', async () => {
    // The backend's own start-time resolution is the capability authority
    // (it fails cleanly before spawning); the panel just shows no list.
    vi.mocked(commands.listOutputDevices).mockResolvedValue({
      status: 'error',
      error: 'Failed to enumerate audio output devices: boom',
    })
    render(<AudioSection section="audio" />)
    await waitFor(() => {
      expect(commands.listOutputDevices).toHaveBeenCalled()
    })
    expect(
      screen.getByRole('combobox', { name: /output device/i })
    ).toBeInTheDocument()
  })

  it('lists the device above the rate — the physical output comes first', () => {
    render(<AudioSection section="audio" />)
    const device = screen.getByRole('combobox', { name: /output device/i })
    const rate = screen.getByRole('combobox', { name: /sample rate/i })
    expect(
      rate.compareDocumentPosition(device) & Node.DOCUMENT_POSITION_PRECEDING
    ).toBeTruthy()
  })
})

/** Plain-text containment for option labels (native text, no testids). */
function withinText(element: HTMLElement, text: string): boolean {
  return element.textContent?.includes(text) ?? false
}
