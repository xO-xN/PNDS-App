import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useSettingsStore } from '@/store/settings-store'
import {
  colorThemeFromPrefs,
  setColorThemeAttribute,
  applyColorThemeSetting,
} from './color-theme'

beforeEach(() => {
  vi.clearAllMocks()
  vi.mocked(commands.loadPreferences).mockResolvedValue({
    status: 'ok',
    data: { theme: 'system', language: null },
  })
  vi.mocked(commands.supportsLiquidGlass).mockResolvedValue({
    status: 'ok',
    data: true,
  })
  // The apply gate reads this store flag — supported by default so the
  // apply tests exercise the real path; the refusal test flips it.
  useSettingsStore.setState({ liquidGlassSupported: true })
})

afterEach(() => {
  delete document.documentElement.dataset.colorTheme
})

describe('colorThemeFromPrefs (issue #38: persisted value → renderable theme)', () => {
  it('passes the four solid themes through regardless of the Glass gate', () => {
    for (const supported of [false, true]) {
      expect(colorThemeFromPrefs('lavender', supported)).toBe('lavender')
      expect(colorThemeFromPrefs('sand', supported)).toBe('sand')
      expect(colorThemeFromPrefs('stage', supported)).toBe('stage')
      expect(colorThemeFromPrefs('midnight', supported)).toBe('midnight')
    }
  })

  it('renders glass only where the version gate allows (issue #41)', () => {
    expect(colorThemeFromPrefs('glass', true)).toBe('glass')
    expect(colorThemeFromPrefs('glass', false)).toBe('lavender')
  })

  it('falls back to Lavender for absent or unknown values', () => {
    expect(colorThemeFromPrefs(null)).toBe('lavender')
    expect(colorThemeFromPrefs(undefined)).toBe('lavender')
    expect(colorThemeFromPrefs('banana', true)).toBe('lavender')
  })
})

describe('setColorThemeAttribute (issue #38: the switching mechanism)', () => {
  it('sets the root node data attribute', () => {
    setColorThemeAttribute('sand')
    expect(document.documentElement.dataset.colorTheme).toBe('sand')

    setColorThemeAttribute('lavender')
    expect(document.documentElement.dataset.colorTheme).toBe('lavender')
  })
})

describe('applyColorThemeSetting (issues #38/#41: apply + native glass + persist)', () => {
  it('applies the attribute, toggles the native glass dressing, and persists', async () => {
    await applyColorThemeSetting('glass')

    expect(document.documentElement.dataset.colorTheme).toBe('glass')
    expect(commands.setLiquidGlass).toHaveBeenCalledWith(true)
    expect(useSettingsStore.getState().colorThemeSetting).toBe('glass')
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ colorTheme: 'glass' })
    )
  })

  // #41 defense in depth: the disabled option is the first gate; this is
  // the second — a programmatic glass request on an old system must not
  // render the CSS frosted approximation (spec #36 forbids it).
  it('refuses glass on an unsupported system, leaving the theme untouched', async () => {
    useSettingsStore.setState({ liquidGlassSupported: false })
    setColorThemeAttribute('lavender')

    await applyColorThemeSetting('glass')

    expect(document.documentElement.dataset.colorTheme).toBe('lavender')
    expect(commands.setLiquidGlass).not.toHaveBeenCalledWith(true)
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('switching from glass back to a solid theme removes the dressing', async () => {
    await applyColorThemeSetting('glass')
    await applyColorThemeSetting('midnight')

    expect(document.documentElement.dataset.colorTheme).toBe('midnight')
    expect(commands.setLiquidGlass).toHaveBeenLastCalledWith(false)
    expect(commands.savePreferences).toHaveBeenLastCalledWith(
      expect.objectContaining({ colorTheme: 'midnight' })
    )
  })

  it('keeps the applied attribute when the persist fails', async () => {
    vi.mocked(commands.savePreferences).mockResolvedValue({
      status: 'error',
      error: 'disk full',
    })

    await applyColorThemeSetting('glass')

    expect(document.documentElement.dataset.colorTheme).toBe('glass')
  })
})
