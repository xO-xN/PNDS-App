import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from './settings-store'

describe('settings-store (v1.2.0 issue #13: settings panel state)', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settingsOpen: false,
      focusSection: null,
      languageSetting: 'system',
      colorThemeSetting: 'lavender',
      liquidGlassSupported: false,
      sampleRateSetting: 48000,
    })
  })

  it('opens closed by default and opens without a focus section', () => {
    expect(useSettingsStore.getState().settingsOpen).toBe(false)
    useSettingsStore.getState().openSettings()
    expect(useSettingsStore.getState().settingsOpen).toBe(true)
    expect(useSettingsStore.getState().focusSection).toBeNull()
  })

  it('openSettings records the section to reveal (About menu routing)', () => {
    useSettingsStore.getState().openSettings('about')
    expect(useSettingsStore.getState().settingsOpen).toBe(true)
    expect(useSettingsStore.getState().focusSection).toBe('about')
  })

  it('closeSettings clears the focus section', () => {
    useSettingsStore.getState().openSettings('about')
    useSettingsStore.getState().closeSettings()
    expect(useSettingsStore.getState().settingsOpen).toBe(false)
    expect(useSettingsStore.getState().focusSection).toBeNull()
  })

  it('toggleSettings flips open → closed and back (⌘, behavior)', () => {
    useSettingsStore.getState().toggleSettings()
    expect(useSettingsStore.getState().settingsOpen).toBe(true)
    useSettingsStore.getState().toggleSettings()
    expect(useSettingsStore.getState().settingsOpen).toBe(false)
  })

  it('toggling open from a focused state drops the stale focus section', () => {
    useSettingsStore.getState().openSettings('about')
    useSettingsStore.getState().toggleSettings()
    useSettingsStore.getState().toggleSettings()
    expect(useSettingsStore.getState().settingsOpen).toBe(true)
    expect(useSettingsStore.getState().focusSection).toBeNull()
  })

  it('setLanguageSetting stores the General-section selection', () => {
    useSettingsStore.getState().setLanguageSetting('zh-CN')
    expect(useSettingsStore.getState().languageSetting).toBe('zh-CN')
  })

  // Issue #21: the Audio-section rate — 48000 (the effective rate of an
  // unset preference) until App.tsx seeds the saved value at startup.
  it('defaults the sample-rate selection to 48000 and stores changes', () => {
    expect(useSettingsStore.getState().sampleRateSetting).toBe(48000)
    useSettingsStore.getState().setSampleRateSetting(96000)
    expect(useSettingsStore.getState().sampleRateSetting).toBe(96000)
  })

  // Issue #38 (v1.2.3): the Appearance-section theme — Lavender until
  // App.tsx seeds the saved value at startup.
  it('defaults the color-theme selection to lavender and stores changes', () => {
    expect(useSettingsStore.getState().colorThemeSetting).toBe('lavender')
    useSettingsStore.getState().setColorThemeSetting('sand')
    expect(useSettingsStore.getState().colorThemeSetting).toBe('sand')
  })

  // Issue #41 (v1.2.3): the Glass gate — pessimistic until App.tsx seeds
  // the version-gate result at startup.
  it('defaults the Glass gate to unsupported and stores the seed', () => {
    expect(useSettingsStore.getState().liquidGlassSupported).toBe(false)
    useSettingsStore.getState().setLiquidGlassSupported(true)
    expect(useSettingsStore.getState().liquidGlassSupported).toBe(true)
  })
})
