import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import userEvent from '@testing-library/user-event'
import {
  render,
  screen,
  fireEvent,
  waitFor,
  cleanup,
  within,
  act,
} from '@/test/test-utils'
import { check } from '@tauri-apps/plugin-updater'
import { locale } from '@tauri-apps/plugin-os'
import { commands } from '@/lib/tauri-bindings'
import i18n from '@/i18n/config'
import { useSettingsStore } from '@/store/settings-store'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { SettingsPanel } from './SettingsPanel'
import type { Manifest } from '@/lib/tauri-bindings'
import { notifications } from '@/lib/notifications'
import { useUpdaterStore } from '@/store/updater-store'

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
  // The model form's shared Switch measures its hidden input in browsers.
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe() {
        /* no layout in jsdom */
      }
      unobserve() {
        /* no layout in jsdom */
      }
      disconnect() {
        /* no layout in jsdom */
      }
    }
  )
  useSettingsStore.setState({
    settingsOpen: false,
    focusSection: null,
    languageSetting: 'system',
    colorThemeSetting: 'pond',
    hideBottomBarText: false,
  })
  useUpdaterStore.setState({ checking: false })
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: { theme: 'system', language: null },
  })
})

afterEach(async () => {
  cleanup()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
  await i18n.changeLanguage('en')
  delete document.documentElement.dataset.colorTheme
})

describe('SettingsPanel (v1.2.0 issue #13)', () => {
  it('renders nothing while closed', () => {
    render(<SettingsPanel />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('offers categorized settings and preserves the general identity controls', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(
      screen.getByRole('radiogroup', { name: 'Theme' })
    ).toBeInTheDocument()
    expect(
      within(screen.getByRole('navigation', { name: 'Settings' }))
        .getAllByRole('button')
        .map(button => button.textContent)
    ).toEqual([
      'General',
      'Audio',
      'Creation assistant',
      'Version control & sync',
      'Network connections',
      'Performer access',
      'About',
    ])
    expect(
      screen.getByRole('textbox', { name: 'Node name' })
    ).toBeInTheDocument()
    for (const name of [
      'Audio',
      'Network connections',
      'Performer access',
      'About',
    ]) {
      fireEvent.click(screen.getByRole('button', { name }))
      expect(await screen.findByRole('heading', { name })).toBeInTheDocument()
    }
    expect(
      screen.queryByRole('heading', { name: 'Projects' })
    ).not.toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Developer Tools' })
    ).not.toBeInTheDocument()
  })

  it('routes GitHub shortcuts to the combined version page without changing attribution', async () => {
    vi.mocked(commands.savePreferences).mockClear()
    useSettingsStore.getState().openSettings('github')
    render(<SettingsPanel />)
    expect(
      screen.getByRole('button', { name: 'Version control & sync' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      screen.getByRole('heading', { name: 'Version control & sync', level: 2 })
    ).toBeVisible()
    expect(screen.getByRole('heading', { name: 'Git identity' })).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'GitHub account' })
    ).toBeVisible()
    await waitFor(() => {
      expect(
        screen.getByRole('textbox', { name: i18n.t('creation.version.name') })
      ).toBeEnabled()
    })
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('finds the moved device name and merged GitHub settings by their original terms', async () => {
    const user = userEvent.setup()
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)
    const navigation = screen.getByRole('navigation', { name: 'Settings' })
    const search = within(navigation).getByRole('searchbox')
    await user.type(search, 'node name')
    expect(
      within(navigation).getByRole('button', { name: 'General' })
    ).toBeVisible()
    expect(
      within(navigation).queryByRole('button', { name: 'Network connections' })
    ).toBeNull()
    await user.clear(search)
    await user.type(search, 'github')
    await user.click(
      within(navigation).getByRole('button', { name: 'Version control & sync' })
    )
    expect(
      screen.getByRole('heading', { name: 'GitHub account' })
    ).toBeVisible()
    expect(screen.queryByRole('textbox', { name: 'Node name' })).toBeNull()
  })

  it('toggles bottom bar details immediately and saves both choices', async () => {
    vi.mocked(commands.savePreferences).mockClear()
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)
    const toggle = screen.getByRole('switch', {
      name: 'Hide bottom bar details',
    })

    expect(toggle).not.toBeChecked()
    fireEvent.click(toggle)
    expect(toggle).toBeChecked()
    expect(useSettingsStore.getState().hideBottomBarText).toBe(true)

    fireEvent.click(toggle)
    expect(toggle).not.toBeChecked()
    expect(useSettingsStore.getState().hideBottomBarText).toBe(false)
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenNthCalledWith(
        1,
        expect.objectContaining({ hideBottomBarText: true })
      )
      expect(commands.savePreferences).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({ hideBottomBarText: false })
      )
    })
  })

  it('routes a legacy developer request to General while the category is temporarily hidden', () => {
    useSettingsStore.getState().openSettings('developer')
    render(<SettingsPanel />)
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'General' })).toHaveAttribute(
      'aria-current',
      'page'
    )
    expect(screen.queryByTestId('developer-target')).not.toBeInTheDocument()
  })

  it('filters categories by keywords without changing the current page and can clear an empty result', async () => {
    const user = userEvent.setup()
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)
    const navigation = screen.getByRole('navigation', { name: 'Settings' })
    const search = within(navigation).getByRole('searchbox', {
      name: i18n.t('settings.presentation.search'),
    })
    await user.type(search, 'sample rate')
    expect(
      within(navigation).getByRole('button', { name: 'Audio' })
    ).toBeVisible()
    expect(
      within(navigation).queryByRole('button', { name: 'Network connections' })
    ).toBeNull()
    expect(
      screen.getByRole('heading', { name: 'General', level: 2 })
    ).toBeVisible()
    expect(useSettingsStore.getState().focusSection).toBeNull()
    await user.clear(search)
    await user.type(search, 'no-such-category')
    expect(within(navigation).getByRole('status')).toHaveTextContent(
      i18n.t('settings.presentation.noResults')
    )
    await user.click(
      within(navigation).getByRole('button', { name: 'Clear search' })
    )
    expect(search).toHaveFocus()
    expect(
      within(navigation).getByRole('button', { name: 'Network connections' })
    ).toBeVisible()
  })

  it('reveals an externally routed category even when a different search is active', async () => {
    const user = userEvent.setup()
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)
    const search = screen.getByRole('searchbox', {
      name: i18n.t('settings.presentation.search'),
    })
    await user.type(search, 'audio')
    expect(
      screen.queryByRole('button', { name: 'Network connections' })
    ).toBeNull()
    act(() => useSettingsStore.getState().openSettings('node'))
    expect(search).toHaveValue('')
    expect(
      screen.getByRole('button', { name: 'Network connections' })
    ).toHaveAttribute('aria-current', 'page')
    expect(
      await screen.findByRole('heading', {
        name: 'Network connections',
        level: 2,
      })
    ).toBeVisible()
  })

  it('retains an initially routed model connection test across category navigation and searching', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        language: 'en',
        modelService: { baseUrl: 'https://model.example/v1', model: 'studio' },
      },
    })
    vi.mocked(commands.getModelCredentialStatus).mockResolvedValueOnce({
      status: 'ok',
      data: { hasKey: true },
    })
    let finish!: (
      result: Awaited<ReturnType<typeof commands.testModelConnection>>
    ) => void
    vi.mocked(commands.testModelConnection).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    useSettingsStore.getState().openSettings('modelService')
    render(<SettingsPanel />)
    const user = userEvent.setup()
    const test = await screen.findByRole('button', { name: 'Test connection' })
    await waitFor(() => expect(test).toBeEnabled())
    const model = screen.getByRole('textbox', { name: 'Model name' })
    await user.click(test)
    await waitFor(() => expect(test).toBeDisabled())
    await user.click(screen.getByRole('button', { name: 'Audio' }))
    const search = screen.getByRole('searchbox', {
      name: i18n.t('settings.presentation.search'),
    })
    await user.type(search, 'context')
    await user.click(screen.getByRole('button', { name: 'Creation assistant' }))
    expect(screen.getByRole('textbox', { name: 'Model name' })).toBe(model)
    expect(model).toHaveValue('studio')
    expect(test).toBeDisabled()
    expect(commands.testModelConnection).toHaveBeenCalledOnce()
    await act(async () =>
      finish({ status: 'ok', data: { text: true, toolCall: true } })
    )
    expect(
      await screen.findByText('Text response and tool round trip passed.')
    ).toBeVisible()
    expect(test).toBeEnabled()
  })

  it('keeps a pending DNS service action mounted when its category is hidden', async () => {
    useSettingsStore.setState({ dnsEnabledSetting: false })
    let finish!: (
      result: Awaited<ReturnType<typeof commands.dnsServiceEnable>>
    ) => void
    vi.mocked(commands.dnsServiceEnable).mockReturnValueOnce(
      new Promise(resolve => {
        finish = resolve
      })
    )
    useSettingsStore.getState().openSettings('dns')
    render(<SettingsPanel />)
    const user = userEvent.setup()
    const toggle = screen.getByTestId('dns-enabled-switch')
    await user.click(toggle)
    expect(toggle).toBeDisabled()
    await user.click(screen.getByRole('button', { name: 'General' }))
    await user.click(screen.getByRole('button', { name: 'Performer access' }))
    expect(screen.getByTestId('dns-enabled-switch')).toBe(toggle)
    expect(toggle).toBeDisabled()
    expect(commands.dnsServiceEnable).toHaveBeenCalledOnce()
    await act(async () =>
      finish({ status: 'error', error: 'Approval declined' })
    )
    expect(toggle).toBeEnabled()
    expect(toggle).not.toBeChecked()
  })

  it('shows the app version in the About section', () => {
    useSettingsStore.getState().openSettings('about')
    render(<SettingsPanel />)
    expect(screen.getByText(`PNDS ${__APP_VERSION__}`)).toBeInTheDocument()
  })

  it('switching to 简体中文 applies immediately and persists', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    await userEvent.click(screen.getByLabelText('Language'))
    await userEvent.click(screen.getByRole('option', { name: '简体中文' }))

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
    useSettingsStore.setState({ languageSetting: 'zh-CN' })
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    await userEvent.click(screen.getByLabelText('Language'))
    await userEvent.click(screen.getByRole('option', { name: 'Follow System' }))

    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ language: null })
      )
    })
    expect(i18n.language).toBe('en')
  })

  it('About buttons check for updates and reveal both directories', async () => {
    useSettingsStore.getState().openSettings('about')
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

  it('disables the update action while its shared manual check is pending', async () => {
    let finish!: (update: null) => void
    vi.mocked(check).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finish = resolve
        })
    )
    useSettingsStore.getState().openSettings('about')
    render(<SettingsPanel />)

    const button = screen.getByRole('button', { name: /check for updates/i })
    fireEvent.click(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAccessibleName('Checking for updates…')
    expect(button).toHaveAttribute('aria-busy', 'true')
    const checks = vi.mocked(check).mock.calls.length
    fireEvent.click(button)
    expect(check).toHaveBeenCalledTimes(checks)

    await act(async () => {
      finish(null)
    })
    await waitFor(() => expect(button).not.toBeDisabled())
    expect(button).toHaveAccessibleName('Check for Updates...')
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

/** All four themes remain visible; pointer and keyboard picks apply and persist. */
describe('SettingsPanel theme row (issues #38/#40)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSettingsStore.setState({
      settingsOpen: false,
      focusSection: null,
      languageSetting: 'system',
      colorThemeSetting: 'pond',
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

    const group = screen.getByRole('radiogroup', { name: 'Theme' })
    const labels = within(group)
      .getAllByRole('radio')
      .map(option => document.querySelector(`label[for="${option.id}"]`))
      .map(option => option?.textContent)
    // v1.3.3 (#90/#91): the default theme's display name is Pond, and
    // since #91 its id is 'pond' as well ('lavender' lives on only as a
    // legacy preference value mapped back to it).
    expect(labels).toEqual(['Pond', 'Sand', 'Stage', 'Brutal'])
    expect(screen.getByRole('radio', { name: 'Pond' })).toBeChecked()
    expect(
      screen.queryByRole('combobox', { name: 'Theme' })
    ).not.toBeInTheDocument()
  })

  it('shows every theme accent before selection', () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    expect(screen.getByTestId('color-theme-accent-pond')).toHaveStyle({
      background: '#1476cc',
    })
    expect(screen.getByTestId('color-theme-accent-sand')).toHaveStyle({
      background: '#93622e',
    })
    expect(screen.getByTestId('color-theme-accent-stage')).toHaveStyle({
      background: '#a5c8b6',
    })
    expect(screen.getByTestId('color-theme-accent-brutal')).toHaveStyle({
      background: '#ff5722',
    })
  })

  it('selecting Sand applies the root attribute immediately and persists', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    await userEvent.click(screen.getByRole('radio', { name: 'Sand' }))

    // #41: the root attribute lands after the window-corner sync (one
    // IPC tick) — the store stays same-tick, the attribute waits.
    await waitFor(() => {
      expect(document.documentElement.dataset.colorTheme).toBe('sand')
    })
    expect(useSettingsStore.getState().colorThemeSetting).toBe('sand')
    expect(screen.getByRole('radio', { name: 'Sand' })).toBeChecked()
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ colorTheme: 'sand' })
      )
    })
  })

  it('switching back to Pond restores the root attribute', async () => {
    useSettingsStore.setState({ colorThemeSetting: 'sand' })
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    await userEvent.click(screen.getByRole('radio', { name: 'Pond' }))

    await waitFor(() => {
      expect(document.documentElement.dataset.colorTheme).toBe('pond')
    })
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ colorTheme: 'pond' })
      )
    })
  })

  // #40: the dark themes ride the same mechanism — one representative
  // switch covers apply + persist for them.
  it('selecting Brutal applies the root attribute immediately and persists', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    await userEvent.click(screen.getByRole('radio', { name: 'Brutal' }))

    await waitFor(() => {
      expect(document.documentElement.dataset.colorTheme).toBe('brutal')
    })
    expect(screen.getByRole('radio', { name: 'Brutal' })).toBeChecked()
    await waitFor(() => {
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ colorTheme: 'brutal' })
      )
    })
  })

  it('switches themes with arrow keys and persists the keyboard choice', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)
    await userEvent.click(screen.getByRole('radio', { name: 'Pond' }))
    // Radix defers roving focus to a timer; keep the key down until that
    // focus arrives, as it does between physical keydown and keyup.
    await userEvent.keyboard('{ArrowRight>}')
    await waitFor(() => {
      expect(screen.getByRole('radio', { name: 'Sand' })).toBeChecked()
      expect(document.documentElement.dataset.colorTheme).toBe('sand')
      expect(commands.savePreferences).toHaveBeenCalledWith(
        expect.objectContaining({ colorTheme: 'sand' })
      )
    })
    await userEvent.keyboard('{/ArrowRight}')
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
    startedAt: '123:456',
    name: 'node',
    commandLine: '/usr/local/bin/node /Users/test/rogue/server.js',
  }

  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(commands.getProjectPorts).mockImplementation(path => {
      const selected =
        path === '/failed/B'
          ? manifestCustomPorts
          : (useProjectStore.getState().currentProject?.manifest ?? manifest)
      return Promise.resolve({
        status: 'ok',
        data: {
          performerPort: selected.scoreServer.performerPort,
          monitorPort: selected.scoreServer.monitorPort,
        },
      })
    })
    useCreationStore.setState({ active: false, workspace: null })
    useSessionStore.setState({ sessionStatus: 'idle', latestSnapshot: null })
    useProjectStore.setState({
      currentProject: null,
      pendingPreflightPath: null,
      failedPreflightPath: null,
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
    useSettingsStore.getState().openSettings('ports')
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

  it('keeps actual running ports when another project is selected', async () => {
    const result = await commands.getSessionState()
    if (result.status !== 'ok') throw new Error(result.error)
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/running/A',
      latestSnapshot: {
        ...result.data,
        status: 'ready',
        projectName: 'Running A',
        projectPath: '/running/A',
        appliedPorts: { performerPort: 51001, monitorPort: 51002 },
      },
    })
    useProjectStore.setState({
      currentProject: { path: '/selected/B', manifest: manifestCustomPorts },
      preflightStatus: 'ready',
    })
    useSettingsStore.getState().openSettings('ports')
    render(<SettingsPanel />)
    await waitFor(() => {
      expect(
        screen.getAllByTestId('port-row').map(row => row.dataset.port)
      ).toEqual(['51001', '51002'])
    })
    expect(commands.checkPortStatus).not.toHaveBeenCalledWith(7000)
    expect(commands.checkPortStatus).not.toHaveBeenCalledWith(7001)
    expect(
      screen.getByText(/^Bound service ports for the current run: Running A\./)
    ).toBeInTheDocument()
    expect(screen.getByText(/7000.*7001/)).toBeInTheDocument()
  })

  it('falls back to 6868/6869 with the hint when no project is selected', async () => {
    useSettingsStore.getState().openSettings('ports')
    render(<SettingsPanel />)

    await waitFor(() => {
      expect(commands.checkPortStatus).toHaveBeenCalledWith(6868)
      expect(commands.checkPortStatus).toHaveBeenCalledWith(6869)
    })
    expect(
      screen.getByText('Default ports (no project selected)')
    ).toBeInTheDocument()
  })

  it('queries selected B without attributing its different ports to running A', async () => {
    vi.mocked(commands.checkPortStatus).mockImplementation(port =>
      Promise.resolve({
        status: 'ok',
        data: {
          port,
          occupant: null,
          managedByApp: false,
          runningProject: null,
        },
      })
    )
    useProjectStore.setState({
      currentProject: { path: '/Users/test/B', manifest: manifestCustomPorts },
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/Users/test/A',
    })
    useSettingsStore.getState().openSettings('ports')
    render(<SettingsPanel />)

    await waitFor(() => {
      expect(screen.getAllByTestId('port-available')).toHaveLength(2)
    })
    expect(screen.queryByTestId('port-running')).not.toBeInTheDocument()
    expect(commands.checkPortStatus).toHaveBeenCalledWith(7000)
    expect(commands.checkPortStatus).toHaveBeenCalledWith(7001)
    useSessionStore.setState({ sessionStatus: 'idle' })
  })

  it('queries the selected failed-preflight project instead of default ports', async () => {
    useProjectStore.setState({
      currentProject: null,
      failedPreflightPath: '/failed/B',
      preflightStatus: 'error',
    })
    useSettingsStore.getState().openSettings('ports')
    render(<SettingsPanel />)
    await waitFor(() => {
      expect(commands.checkPortStatus).toHaveBeenCalledWith(7000)
      expect(commands.checkPortStatus).toHaveBeenCalledWith(7001)
    })
    expect(
      screen.queryByText('Default ports (no project selected)')
    ).not.toBeInTheDocument()
  })

  it('shows the occupant identity and releases after a full-identity confirm', async () => {
    vi.mocked(commands.checkPortStatus).mockImplementation(port =>
      Promise.resolve(
        port === 6868
          ? {
              status: 'ok',
              data: {
                port,
                occupant,
                managedByApp: false,
                runningProject: null,
              },
            }
          : {
              status: 'ok',
              data: {
                port,
                occupant: null,
                managedByApp: false,
                runningProject: null,
              },
            }
      )
    )
    vi.mocked(commands.releasePort).mockResolvedValue({
      status: 'ok',
      data: {
        outcome: 'released',
        status: {
          port: 6868,
          occupant: null,
          managedByApp: false,
          runningProject: null,
        },
      },
    })
    useSettingsStore.getState().openSettings('ports')
    render(<SettingsPanel />)

    expect(await screen.findByTestId('port-in-use')).toHaveTextContent('In use')
    const details = screen.getByTestId('port-occupant').closest('details')
    expect(details).not.toHaveAttribute('open')
    fireEvent.click(screen.getByText('Process details'))
    expect(details).toHaveAttribute('open')
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

    vi.mocked(commands.checkPortStatus).mockImplementation(port =>
      Promise.resolve({
        status: 'ok',
        data: {
          port,
          occupant: null,
          managedByApp: false,
          runningProject: null,
        },
      })
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release' }))

    await waitFor(() => {
      expect(commands.releasePort).toHaveBeenCalledWith(6868, occupant)
    })
    await waitFor(() => {
      // Both rows read available — 6868 after the release, 6869 all along.
      expect(screen.getAllByTestId('port-available')).toHaveLength(2)
    })
    expect(screen.queryByTestId('port-occupant')).not.toBeInTheDocument()
  })

  it('the Refresh button re-queries both ports on demand', async () => {
    useSettingsStore.getState().openSettings('ports')
    render(<SettingsPanel />)

    await waitFor(() => {
      expect(commands.checkPortStatus).toHaveBeenCalledTimes(2)
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(commands.checkPortStatus).toHaveBeenCalledTimes(4)
    })
  })

  it('queries the creation workspace saved manifest and rereads it on refresh', async () => {
    useCreationStore.setState({
      active: true,
      workspace: {
        project: {
          identity: 'workspace-B',
          root: '/B',
          name: 'B',
          source: 'folder',
        },
        files: [],
      },
    })
    vi.mocked(commands.getCreationManifest).mockResolvedValue({
      status: 'ok',
      data: manifestCustomPorts,
    })
    vi.mocked(commands.checkPortStatus).mockImplementation(port =>
      Promise.resolve({
        status: 'ok',
        data: {
          port,
          occupant: null,
          managedByApp: false,
          runningProject: null,
        },
      })
    )
    useProjectStore.setState({ currentProject: { path: '/A', manifest } })
    useSettingsStore.getState().openSettings('ports')
    render(<SettingsPanel />)
    await waitFor(() => {
      expect(
        screen.getAllByTestId('port-row').map(row => row.dataset.port)
      ).toEqual(['7000', '7001'])
    })
    expect(commands.getCreationManifest).toHaveBeenCalledWith('workspace-B')
    expect(commands.checkPortStatus).not.toHaveBeenCalledWith(6868)

    vi.mocked(commands.getCreationManifest).mockResolvedValue({
      status: 'ok',
      data: {
        ...manifestCustomPorts,
        scoreServer: {
          ...manifestCustomPorts.scoreServer,
          performerPort: 7100,
          monitorPort: 7101,
        },
      },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Refresh' }))
    await waitFor(() => {
      expect(
        screen.getAllByTestId('port-row').map(row => row.dataset.port)
      ).toEqual(['7100', '7101'])
    })
    expect(commands.startProject).not.toHaveBeenCalled()
    useCreationStore.setState({ active: false, workspace: null })
  })

  it('cancels a stale release and refreshes the new managed identity', async () => {
    const neutral = vi
      .spyOn(notifications, 'message')
      .mockResolvedValue(undefined)
    const failure = vi
      .spyOn(notifications, 'error')
      .mockResolvedValue(undefined)
    const managed = {
      port: 6868,
      occupant,
      managedByApp: true,
      runningProject: 'Running A',
    }
    vi.mocked(commands.checkPortStatus).mockImplementation(port =>
      Promise.resolve({
        status: 'ok',
        data: {
          port,
          occupant: port === 6868 ? occupant : null,
          managedByApp: false,
          runningProject: null,
        },
      })
    )
    vi.mocked(commands.releasePort).mockResolvedValue({
      status: 'ok',
      data: { outcome: 'cancelled', status: managed },
    })
    useSettingsStore.getState().openSettings('ports')
    render(<SettingsPanel />)
    await screen.findByTestId('port-in-use')
    fireEvent.click(screen.getByRole('button', { name: 'Release' }))
    const dialog = screen.getByRole('alertdialog')
    vi.mocked(commands.checkPortStatus).mockImplementation(port =>
      Promise.resolve({
        status: 'ok',
        data:
          port === 6868
            ? managed
            : {
                port,
                occupant: null,
                managedByApp: false,
                runningProject: null,
              },
      })
    )
    fireEvent.click(within(dialog).getByRole('button', { name: 'Release' }))
    expect(await screen.findByText('Running: Running A')).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Release' })
    ).not.toBeInTheDocument()
    expect(commands.checkPortStatus).toHaveBeenCalledTimes(4)
    expect(neutral).toHaveBeenCalledExactlyOnceWith(
      'Release cancelled: the process or its ownership changed. Port status refreshed.'
    )
    expect(failure).not.toHaveBeenCalled()
  })

  it('shows the backend running project and offers no release for managed ports', async () => {
    vi.mocked(commands.checkPortStatus).mockImplementation(port =>
      Promise.resolve({
        status: 'ok',
        data: {
          port,
          occupant,
          managedByApp: true,
          runningProject: 'Project A',
        },
      })
    )
    useProjectStore.setState({
      currentProject: { path: '/Users/test/p', manifest },
      preflightStatus: 'ready',
    })
    useSessionStore.setState({ sessionStatus: 'ready' })
    useSettingsStore.getState().openSettings('ports')
    render(<SettingsPanel />)

    expect(await screen.findAllByTestId('port-running')).toHaveLength(2)
    expect(
      screen.getAllByText('Close the project to release its ports.')
    ).toHaveLength(1)
    expect(screen.getAllByText('Running: Project A')).toHaveLength(2)
    expect(screen.getAllByTestId('port-occupant')).toHaveLength(2)
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
    useSettingsStore.getState().openSettings('audio')
    render(<SettingsPanel />)
    return screen.getByLabelText('Sample rate')
  }

  it('shows the effective rate — 48000 when the preference is unset', async () => {
    const select = openPanel()

    expect(screen.getByRole('heading', { name: 'Audio' })).toBeInTheDocument()
    expect(select).toHaveTextContent('48 kHz')
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
    await userEvent.click(select)

    await waitFor(() => {
      const labels = screen
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
    await userEvent.click(select)

    await waitFor(() => {
      const labels = screen
        .getAllByRole('option')
        .map(option => option.textContent)
      expect(labels).toEqual(['44.1 kHz', '48 kHz', '88.2 kHz', '96 kHz'])
    })
    expect(select).toHaveTextContent('48 kHz')
  })

  it('selecting a rate updates the store and persists via the queued save', async () => {
    vi.mocked(commands.listSupportedSampleRates).mockResolvedValue([
      44100, 48000, 96000,
    ])
    const select = openPanel()

    await userEvent.click(select)
    await userEvent.click(screen.getByRole('option', { name: '96 kHz' }))

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
    await userEvent.click(select)

    await waitFor(() => {
      const labels = screen
        .getAllByRole('option')
        .map(option => option.textContent)
      expect(labels).toEqual(['44.1 kHz', '48 kHz', '88.2 kHz'])
    })
    expect(select).toHaveTextContent('88.2 kHz')
  })

  it.each(['ready', 'idle'] as const)(
    'keeps audio editable without a claimed runtime difference when %s has no snapshot',
    status => {
      useSessionStore.setState({ sessionStatus: status, latestSnapshot: null })
      expect(openPanel()).toBeEnabled()
      expect(screen.queryByTestId('sample-rate-hint')).toBeNull()
      expect(
        screen.queryByText(
          'A project is running — changes apply at its next start.'
        )
      ).toBeNull()
      expect(
        screen.queryByText('Applies at the next project start.')
      ).toBeNull()
    }
  )
})
