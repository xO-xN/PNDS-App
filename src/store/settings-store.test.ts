import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from './settings-store'

describe('settings-store (v1.2.0 issue #13: settings panel state)', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settingsOpen: false,
      focusSection: null,
      languageSetting: 'system',
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
})
