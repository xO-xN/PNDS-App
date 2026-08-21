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
  it('passes the shipped themes through', () => {
    expect(colorThemeFromPrefs('lavender')).toBe('lavender')
    expect(colorThemeFromPrefs('sand')).toBe('sand')
  })

  it('falls back to Lavender for absent, unknown, or not-yet-shipped values', () => {
    // stage/midnight/glass are valid in the persisted enum (later v1.2.3
    // tickets) but this build cannot render them — spec #36 story 10.
    expect(colorThemeFromPrefs(null)).toBe('lavender')
    expect(colorThemeFromPrefs(undefined)).toBe('lavender')
    expect(colorThemeFromPrefs('banana')).toBe('lavender')
    expect(colorThemeFromPrefs('stage')).toBe('lavender')
    expect(colorThemeFromPrefs('midnight')).toBe('lavender')
    expect(colorThemeFromPrefs('glass')).toBe('lavender')
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
})
