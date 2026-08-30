import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
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
})

afterEach(() => {
  delete document.documentElement.dataset.colorTheme
})

describe('colorThemeFromPrefs (issue #38: persisted value → renderable theme)', () => {
  it('passes the four shipped themes through', () => {
    expect(colorThemeFromPrefs('pond')).toBe('pond')
    expect(colorThemeFromPrefs('sand')).toBe('sand')
    expect(colorThemeFromPrefs('stage')).toBe('stage')
    expect(colorThemeFromPrefs('brutal')).toBe('brutal')
  })

  it('maps renamed themes to their successor (#41: midnight → brutal; #91: lavender → pond)', () => {
    expect(colorThemeFromPrefs('midnight')).toBe('brutal')
    // #91: the default theme's id joined its display name — installs
    // persisted before the rename migrate silently to pond.
    expect(colorThemeFromPrefs('lavender')).toBe('pond')
  })

  it('falls back to Pond for absent, unknown, or not-yet-shipped values', () => {
    // glass is valid in the persisted enum (the abandoned liquid-glass
    // ticket) but this build cannot render it — spec #36 story 10.
    expect(colorThemeFromPrefs(null)).toBe('pond')
    expect(colorThemeFromPrefs(undefined)).toBe('pond')
    expect(colorThemeFromPrefs('banana')).toBe('pond')
    expect(colorThemeFromPrefs('glass')).toBe('pond')
  })
})

describe('setColorThemeAttribute (issue #38: the switching mechanism)', () => {
  it('sets the root node data attribute', () => {
    setColorThemeAttribute('sand')
    expect(document.documentElement.dataset.colorTheme).toBe('sand')

    setColorThemeAttribute('pond')
    expect(document.documentElement.dataset.colorTheme).toBe('pond')
  })
})

describe('applyColorThemeSetting (issue #38: apply + persist)', () => {
  it('applies the attribute, updates the store, and persists the patch', async () => {
    await applyColorThemeSetting('sand')

    expect(document.documentElement.dataset.colorTheme).toBe('sand')
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ colorTheme: 'sand' })
    )
  })

  it('keeps the applied attribute when the persist fails', async () => {
    vi.mocked(commands.savePreferences).mockResolvedValue({
      status: 'error',
      error: 'disk full',
    })

    await applyColorThemeSetting('sand')

    expect(document.documentElement.dataset.colorTheme).toBe('sand')
  })

  // #41: Brutal squares the native window corners; every other theme
  // keeps the 16px mask. The sync runs before the attribute so the
  // native edge never lags the CSS edge.
  it('syncs the window corner style with the theme (#41)', async () => {
    await applyColorThemeSetting('brutal')
    expect(commands.setWindowCornersSquare).toHaveBeenCalledWith(true)
    expect(document.documentElement.dataset.colorTheme).toBe('brutal')

    await applyColorThemeSetting('pond')
    expect(commands.setWindowCornersSquare).toHaveBeenCalledWith(false)
    expect(document.documentElement.dataset.colorTheme).toBe('pond')
  })
})
