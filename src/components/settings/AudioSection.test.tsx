import { render, screen, waitFor } from '@/test/test-utils'
import userEvent from '@testing-library/user-event'
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { toast } from 'sonner'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { AudioSection } from './AudioSection'
import type { Manifest } from '@/lib/tauri-bindings'

vi.mock('sonner', () => ({
  toast: { info: vi.fn(), error: vi.fn() },
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

/**
 * #58: the output device moved from the sidebar settings card into the
 * settings Audio section — the §6.3/§7.6 display contract travels intact
 * (channel counts, greyed-but-selectable loss entries, the closed
 * trigger's red dot), joined to the sample rate's next-start semantics
 * (locked while a session runs).
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
    useSessionStore.getState().resetSession()
    useSessionStore.setState({ outputDevice: 'System default' })
  })

  it('marks a 16ch project’s 2ch device as greyed-but-selectable with the red loss text (§6.3)', async () => {
    const user = userEvent.setup()
    render(<AudioSection section="audio" />)

    await user.click(
      await screen.findByRole('combobox', { name: /output device/i })
    )
    const option = await screen.findByRole('option', {
      name: /Mac mini Speakers/,
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
      await screen.findByRole('option', { name: /Mac mini Speakers/ })
    )

    const hint = screen.getByTestId('device-insufficient-hint')
    expect(hint).toHaveTextContent('16ch → 2ch')
    expect(toast.info).not.toHaveBeenCalled()
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

    render(<AudioSection section="audio" />)
    await waitFor(() => {
      expect(useSessionStore.getState().outputDevice).toBe('System default')
    })
    expect(toast.info).toHaveBeenCalledWith(
      expect.stringContaining('not available')
    )

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

  it('keeps the row locked while a session runs (next-start semantics)', async () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
    })
    render(<AudioSection section="audio" />)
    const device = await screen.findByRole('combobox', {
      name: /output device/i,
    })
    expect(device).toBeDisabled()
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
})

/** Plain-text containment for option labels (native text, no testids). */
function withinText(element: HTMLElement, text: string): boolean {
  return element.textContent?.includes(text) ?? false
}
