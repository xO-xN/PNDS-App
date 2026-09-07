import { describe, it, expect, beforeEach } from 'vitest'
import { useSettingsStore } from './settings-store'

describe('settings-store (v1.2.0 issue #13: settings panel state)', () => {
  beforeEach(() => {
    useSettingsStore.setState({
      settingsOpen: false,
      focusSection: null,
      languageSetting: 'system',
      colorThemeSetting: 'pond',
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

  // Issue #38 (v1.2.3): the Appearance-section theme — Pond until
  // App.tsx seeds the saved value at startup.
  it('defaults the color-theme selection to pond and stores changes', () => {
    expect(useSettingsStore.getState().colorThemeSetting).toBe('pond')
    useSettingsStore.getState().setColorThemeSetting('sand')
    expect(useSettingsStore.getState().colorThemeSetting).toBe('sand')
  })

  // #58: the Node section's identity trio and the room groups — empty
  // until App.tsx seeds the saved values at startup (the「设置节点」gate
  // reads completeness from these, so unset must read as blank, not
  // undefined).
  it('defaults the node config to blank and stores changes', () => {
    const store = useSettingsStore.getState()
    expect(store.nodeNameSetting).toBe('')
    expect(store.hubUrlSetting).toBe('')
    expect(store.hubTokenSetting).toBe('')
    expect(store.hubRooms).toEqual({})
    expect(store.hostnameHint).toBe('')

    store.setNodeNameSetting('Concert-MacBook')
    store.setHubUrlSetting('wss://hub.example.org:3000')
    store.setHubTokenSetting('secret-token')
    store.setHostnameHint('Concert-MacBook.local')
    useSettingsStore.getState().setHubRooms({ 'inarticulate-iii': 2 })
    const next = useSettingsStore.getState()
    expect(next.nodeNameSetting).toBe('Concert-MacBook')
    expect(next.hubUrlSetting).toBe('wss://hub.example.org:3000')
    expect(next.hubTokenSetting).toBe('secret-token')
    expect(next.hostnameHint).toBe('Concert-MacBook.local')
    expect(next.hubRooms).toEqual({ 'inarticulate-iii': 2 })
  })
})
