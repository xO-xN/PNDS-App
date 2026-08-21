import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
} from '@/test/test-utils'
import { check } from '@tauri-apps/plugin-updater'
import { locale } from '@tauri-apps/plugin-os'
import { commands } from '@/lib/tauri-bindings'
import i18n from '@/i18n/config'
import { useSettingsStore } from '@/store/settings-store'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { SettingsPanel } from './SettingsPanel'
import type { Manifest } from '@/lib/tauri-bindings'

// applyLanguageSetting('system') re-detects the OS locale — keep it fixed.
vi.mock('@tauri-apps/plugin-os', () => ({
  locale: vi.fn().mockResolvedValue('en-US'),
}))

/** Mounts the panel plus the shell keyboard layer, like the real app. */
function KeyboardHarness() {
  useCommandKeyboard()
  return <SettingsPanel />
}

const pressCmdComma = () =>
  window.dispatchEvent(
    new KeyboardEvent('keydown', { key: ',', metaKey: true })
  )

beforeEach(() => {
  useSettingsStore.setState({
    settingsOpen: false,
    focusSection: null,
    languageSetting: 'system',
    colorThemeSetting: 'lavender',
  })
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: { theme: 'system', language: null },
  })
})

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
  delete document.documentElement.dataset.colorTheme
})

describe('SettingsPanel (v1.2.0 issue #13)', () => {
  it('renders nothing while closed', () => {
    render(<SettingsPanel />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the six sections of the single-page panel', () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Appearance' })
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Audio' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ports' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Developer Tools' })
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    // The Projects history section (#15) was removed after user review —
    // history management lives in the sidebar alone.
    expect(
      screen.queryByRole('heading', { name: 'Projects' })
    ).not.toBeInTheDocument()
    // The developer section packs .pnds bundles (issue #16) — its action is
    // present even with no project selected.
    expect(
      screen.getByRole('button', { name: 'Pack Bundle' })
    ).toBeInTheDocument()
  })

  it('shows the app version in the About section', () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)
    expect(screen.getByText(`PNDS ${__APP_VERSION__}`)).toBeInTheDocument()
  })

  it('switching to 简体中文 applies immediately and persists', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    fireEvent.change(screen.getByLabelText('Language'), {
      target: { value: 'zh-CN' },
    })

    // UI switches without a restart (the menu rebuild rides the same
    // languageChanged event).
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: '通用' })).toBeInTheDocument()
    })
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ language: 'zh-CN' })
      )
    })
  })

  it('switching back to Follow System persists language: null', async () => {
    vi.mocked(locale).mockResolvedValue('en-US')
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    fireEvent.change(screen.getByLabelText('Language'), {
      target: { value: 'system' },
    })

    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ language: null })
      )
    })
    expect(i18n.language).toBe('en')
  })

  it('About buttons check for updates and reveal both directories', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    fireEvent.click(screen.getByRole('button', { name: /check for updates/i }))
    await waitFor(() => expect(check).toHaveBeenCalledTimes(1))

    fireEvent.click(screen.getByRole('button', { name: /open data folder/i }))
    await waitFor(() =>
      expect(commands.openAppDataDir).toHaveBeenCalledTimes(1)
    )

    fireEvent.click(screen.getByRole('button', { name: /open logs folder/i }))
    await waitFor(() => expect(commands.openAppLogDir).toHaveBeenCalledTimes(1))
  })

  it('Esc closes the panel', () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    fireEvent.keyDown(screen.getByRole('dialog'), { key: 'Escape' })
    expect(useSettingsStore.getState().settingsOpen).toBe(false)
  })

  it('the macOS-style top-left close button closes the panel', () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    fireEvent.click(screen.getByRole('button', { name: 'Close' }))
    expect(useSettingsStore.getState().settingsOpen).toBe(false)
  })

  it('⌘, toggles the panel open and closed via the keyboard layer', () => {
    render(<KeyboardHarness />)

    pressCmdComma()
    expect(useSettingsStore.getState().settingsOpen).toBe(true)

    pressCmdComma()
    expect(useSettingsStore.getState().settingsOpen).toBe(false)
  })

  it('scrolls the About section into view when routed from the About menu item', async () => {
    const scrollIntoView = vi.fn()
    Element.prototype.scrollIntoView = scrollIntoView
    useSettingsStore.getState().openSettings('about')
    render(<SettingsPanel />)

    await waitFor(() => {
      const about = document.getElementById('settings-section-about')
      expect(about).not.toBeNull()
      expect(scrollIntoView).toHaveBeenCalled()
    })
  })
})

/** Issue #38 (v1.2.3 T2): the Appearance section — a NativeSelect offering
 * the shipped themes with the current accent swatch beside it; selecting
 * one applies the root data-color-theme attribute immediately and persists
 * the colorTheme preference. #40 added the two dark themes. */
describe('SettingsPanel Appearance section (issues #38/#40)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      settingsOpen: false,
      focusSection: null,
      languageSetting: 'system',
      colorThemeSetting: 'lavender',
      sampleRateSetting: 48000,
    })
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: null },
    })
  })

  afterEach(() => {
    cleanup()
    delete document.documentElement.dataset.colorTheme
  })

  it('offers the four shipped themes with the current one selected', () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    const select = screen.getByLabelText('Theme')
    const labels = within(select)
      .getAllByRole('option')
      .map(option => option.textContent)
    expect(labels).toEqual(['Lavender', 'Sand', 'Stage', 'Midnight'])
    expect(select).toHaveValue('lavender')
  })

  it('shows the accent swatch of the selected theme', () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    expect(screen.getByTestId('color-theme-accent')).toHaveStyle({
      background: '#5a4ff3',
    })
  })

  it('selecting Sand applies the root attribute immediately and persists', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    fireEvent.change(screen.getByLabelText('Theme'), {
      target: { value: 'sand' },
    })

    // Immediate: the root data-color-theme flips without a restart.
    expect(document.documentElement.dataset.colorTheme).toBe('sand')
    expect(useSettingsStore.getState().colorThemeSetting).toBe('sand')
    expect(screen.getByTestId('color-theme-accent')).toHaveStyle({
      background: '#d97706',
    })
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ colorTheme: 'sand' })
      )
    })
  })

  it('switching back to Lavender restores the root attribute', async () => {
    useSettingsStore.setState({ colorThemeSetting: 'sand' })
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    fireEvent.change(screen.getByLabelText('Theme'), {
      target: { value: 'lavender' },
    })

    expect(document.documentElement.dataset.colorTheme).toBe('lavender')
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ colorTheme: 'lavender' })
      )
    })
  })

  // #40: the dark themes ride the same mechanism — one representative
  // switch covers apply + persist for them.
  it('selecting Midnight applies the root attribute immediately and persists', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    fireEvent.change(screen.getByLabelText('Theme'), {
      target: { value: 'midnight' },
    })

    expect(document.documentElement.dataset.colorTheme).toBe('midnight')
    expect(screen.getByTestId('color-theme-accent')).toHaveStyle({
      background: '#818cf8',
    })
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ colorTheme: 'midnight' })
      )
    })
  })
})

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
    synthdefs: null,
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

/** v1.2.0 (issue #14): the Ports section watches the selected project's
 * manifest ports (6868/6869 fallback), shows occupant identity, releases
 * behind a confirm dialog, and queries only on open + manual refresh. */
describe('SettingsPanel Ports section (v1.2.0 issue #14)', () => {
  const manifestCustomPorts: Manifest = {
    ...manifest,
    scoreServer: {
      entry: 'server.js',
      workingDirectory: '.',
      performerPort: 7000,
      monitorPort: 7001,
    },
  }

  const occupant = {
    pid: 4242,
    name: 'node',
    commandLine: '/usr/local/bin/node /Users/test/rogue/server.js',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: null,
      recentProjectPaths: [],
      projectFolders: [],
      activeFolderId: null,
      projectDisplayNames: {},
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  afterEach(() => {
    cleanup()
  })

  it('queries the selected project’s manifest ports once on open, no polling', async () => {
    useProjectStore.setState({
      currentProject: { path: '/Users/test/p', manifest: manifestCustomPorts },
      preflightStatus: 'ready',
    })
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    await waitFor(() => {
      expect(commands.checkPortStatus).toHaveBeenCalledWith(7000)
      expect(commands.checkPortStatus).toHaveBeenCalledWith(7001)
    })
    const callsAfterOpen = vi.mocked(commands.checkPortStatus).mock.calls.length
    // No timer, no interval: the count stays put without user action.
    await new Promise(resolve => setTimeout(resolve, 120))
    expect(vi.mocked(commands.checkPortStatus).mock.calls.length).toBe(
      callsAfterOpen
    )

    const rows = screen.getAllByTestId('port-row')
    expect(rows.map(row => row.dataset.port)).toEqual(['7000', '7001'])
    expect(screen.getAllByTestId('port-available')).toHaveLength(2)
  })

  it('falls back to 6868/6869 with the hint when no project is selected', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    await waitFor(() => {
      expect(commands.checkPortStatus).toHaveBeenCalledWith(6868)
      expect(commands.checkPortStatus).toHaveBeenCalledWith(6869)
    })
    expect(
      screen.getByText('Default ports (no project selected)')
    ).toBeInTheDocument()
  })

  it('shows the occupant identity and releases after a full-identity confirm', async () => {
    vi.mocked(commands.checkPortStatus).mockImplementation(port =>
      Promise.resolve(
        port === 6868
          ? { status: 'ok', data: { port, occupant } }
          : { status: 'ok', data: { port, occupant: null } }
      )
    )
    vi.mocked(commands.releasePort).mockResolvedValue({
      status: 'ok',
      data: { port: 6868, occupant: null },
    })
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    expect(await screen.findByTestId('port-in-use')).toHaveTextContent('In use')
    expect(screen.getByTestId('port-occupant')).toHaveTextContent('4242')
    expect(screen.getByTestId('port-occupant')).toHaveTextContent(
      '/usr/local/bin/node /Users/test/rogue/server.js'
    )

    fireEvent.click(screen.getByRole('button', { name: 'Release' }))

    // The confirm dialog repeats the full identity before anything dies.
    const dialog = await screen.findByRole('alertdialog')
    expect(dialog).toHaveTextContent('Release port 6868?')
    expect(dialog).toHaveTextContent('4242')
    expect(dialog).toHaveTextContent(
      '/usr/local/bin/node /Users/test/rogue/server.js'
    )
    expect(commands.releasePort).not.toHaveBeenCalled()

    fireEvent.click(within(dialog).getByRole('button', { name: 'Release' }))

    await waitFor(() => {
      expect(commands.releasePort).toHaveBeenCalledWith(6868)
    })
    await waitFor(() => {
      // Both rows read available — 6868 after the release, 6869 all along.
      expect(screen.getAllByTestId('port-available')).toHaveLength(2)
    })
    expect(screen.queryByTestId('port-occupant')).not.toBeInTheDocument()
  })

  it('the Refresh button re-queries both ports on demand', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    await waitFor(() => {
      expect(commands.checkPortStatus).toHaveBeenCalledTimes(2)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(commands.checkPortStatus).toHaveBeenCalledTimes(4)
    })
  })

  it('shows “this project is running” and offers no release while the session is live', async () => {
    vi.mocked(commands.checkPortStatus).mockImplementation(port =>
      Promise.resolve({
        status: 'ok',
        data: { port, occupant },
      })
    )
    useProjectStore.setState({
      currentProject: { path: '/Users/test/p', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    expect(await screen.findAllByTestId('port-running')).toHaveLength(2)
    expect(
      screen.getAllByText('Close the project to release its ports.')
    ).toHaveLength(2)
    // Our own session holds the ports — no occupant dump, no Release.
    expect(screen.queryByTestId('port-occupant')).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Release' })
    ).not.toBeInTheDocument()
    useSessionStore.setState({ sessionStatus: 'idle' })
  })
})

/** Issue #21: the Audio section — the App's global sample rate (the sole
 * audio authority since #20) as an inline select: the device-supported
 * union with the fixed fallback, an immediate queued save, and a hard lock
 * while a session runs. */
describe('SettingsPanel Audio section (issue #21)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      settingsOpen: false,
      focusSection: null,
      languageSetting: 'system',
      sampleRateSetting: 48000,
    })
    useSessionStore.setState({ sessionStatus: 'idle' })
    // Explicit per-describe implementations: clearAllMocks keeps the ones
    // set by earlier tests, which would couple these to execution order.
    vi.mocked(commands.listSupportedSampleRates).mockResolvedValue([
      44100, 48000, 88200, 96000,
    ])
    // The queued save is a load-modify-write cycle over the same file.
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: null, sampleRate: null },
    })
  })

  afterEach(() => {
    cleanup()
    useSessionStore.setState({ sessionStatus: 'idle' })
  })

  const openPanel = () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)
    return screen.getByLabelText('Sample rate')
  }

  it('shows the effective rate — 48000 when the preference is unset', async () => {
    const select = openPanel()

    expect(screen.getByRole('heading', { name: 'Audio' })).toBeInTheDocument()
    expect(select).toHaveValue('48000')
    // One capability query per panel open, like the Ports section.
    await waitFor(() =>
      expect(commands.listSupportedSampleRates).toHaveBeenCalledTimes(1)
    )
  })

  it('lists the device-supported union ascending, formatted in kHz', async () => {
    vi.mocked(commands.listSupportedSampleRates).mockResolvedValue([
      44100, 48000, 96000,
    ])
    const select = openPanel()

    await waitFor(() => {
      const labels = within(select)
        .getAllByRole('option')
        .map(option => option.textContent)
      expect(labels).toEqual(['44.1 kHz', '48 kHz', '96 kHz'])
    })
  })

  it('falls back to the fixed list when the capability query fails', async () => {
    vi.mocked(commands.listSupportedSampleRates).mockRejectedValue(
      new Error('transport down')
    )
    const select = openPanel()

    await waitFor(() => {
      const labels = within(select)
        .getAllByRole('option')
        .map(option => option.textContent)
      expect(labels).toEqual(['44.1 kHz', '48 kHz', '88.2 kHz', '96 kHz'])
    })
    expect(select).toHaveValue('48000')
  })

  it('selecting a rate updates the store and persists via the queued save', async () => {
    vi.mocked(commands.listSupportedSampleRates).mockResolvedValue([
      44100, 48000, 96000,
    ])
    const select = openPanel()

    fireEvent.change(select, { target: { value: '96000' } })

    expect(useSettingsStore.getState().sampleRateSetting).toBe(96000)
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ sampleRate: 96000 })
      )
    })
  })

  it('keeps a saved rate visible even when the hardware no longer offers it', async () => {
    useSettingsStore.getState().setSampleRateSetting(88200)
    vi.mocked(commands.listSupportedSampleRates).mockResolvedValue([
      44100, 48000,
    ])
    const select = openPanel()

    await waitFor(() => {
      const labels = within(select)
        .getAllByRole('option')
        .map(option => option.textContent)
      expect(labels).toEqual(['44.1 kHz', '48 kHz', '88.2 kHz'])
    })
    expect(select).toHaveValue('88200')
  })

  it('locks the control with an explanatory hint while a session runs', async () => {
    useSessionStore.setState({ sessionStatus: 'ready' })
    const select = openPanel()

    expect(select).toBeDisabled()
    expect(
      screen.getByText('Stop the project to change the sample rate.')
    ).toBeInTheDocument()
    expect(
      screen.queryByText('Applies at the next project start.')
    ).not.toBeInTheDocument()
    expect(commands.savePreferences).not.toHaveBeenCalled()

    // 'error' is not a running session — a boot failure at one rate must
    // not lock the user out of picking another.
    useSessionStore.setState({ sessionStatus: 'error' })
    await waitFor(() =>
      expect(screen.getByLabelText('Sample rate')).toBeEnabled()
    )
  })

  it('explains that an idle change applies at the next project start', async () => {
    openPanel()

    await waitFor(() => {
      expect(
        screen.getByText('Applies at the next project start.')
      ).toBeInTheDocument()
    })
  })
})
