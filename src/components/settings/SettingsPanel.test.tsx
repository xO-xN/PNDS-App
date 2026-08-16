import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor, cleanup } from '@/test/test-utils'
import { check } from '@tauri-apps/plugin-updater'
import { locale } from '@tauri-apps/plugin-os'
import { commands } from '@/lib/tauri-bindings'
import i18n from '@/i18n/config'
import { useSettingsStore } from '@/store/settings-store'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { SettingsPanel } from './SettingsPanel'

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
  })
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: { theme: 'system', language: null },
  })
})

afterEach(async () => {
  cleanup()
  await i18n.changeLanguage('en')
})

describe('SettingsPanel (v1.2.0 issue #13)', () => {
  it('renders nothing while closed', () => {
    render(<SettingsPanel />)
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
  })

  it('renders the five sections of the single-page panel', () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    expect(screen.getByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'General' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Ports' })).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Projects' })
    ).toBeInTheDocument()
    expect(
      screen.getByRole('heading', { name: 'Developer Tools' })
    ).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'About' })).toBeInTheDocument()
    // Placeholder sections announce their status.
    expect(screen.getAllByText(/v1\.2\.0/).length).toBeGreaterThan(0)
  })

  it('shows the app version in the About section', () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)
    expect(screen.getByText(`PNDS ${__APP_VERSION__}`)).toBeInTheDocument()
  })

  it('switching to 简体中文 applies immediately and persists', async () => {
    useSettingsStore.getState().openSettings()
    render(<SettingsPanel />)

    fireEvent.change(screen.getByRole('combobox'), {
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

    fireEvent.change(screen.getByRole('combobox'), {
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
