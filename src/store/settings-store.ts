import { create } from 'zustand'
import { DEFAULT_SAMPLE_RATE } from '@/lib/preferences'
// Type-only: a runtime import here would cycle (color-theme imports this
// store for applyColorThemeSetting), and the cycle evaluates this module
// while color-theme's constants are still uninitialized.
import type { ColorTheme } from '@/lib/color-theme'

/** The sections of the settings panel (spec issue #12, single-page scroll
 * layout; issue #21 added Audio, issue #38 added Appearance, #58 added
 * Node). The Projects history section (#15) was removed after user
 * review — history management lives in the sidebar alone. */
export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'audio'
  | 'node'
  | 'ports'
  | 'developer'
  | 'about'

/** Language choices in the General section. 'system' follows the OS locale
 * and corresponds to `preferences.language === null` on disk. */
export type LanguageSetting = 'en' | 'zh-CN' | 'system'

interface SettingsState {
  /** v1.2.0 (issue #13): the in-app settings panel is open (⌘, / menu). */
  settingsOpen: boolean
  /** Section to reveal when the panel opens (the About menu item routes
   * here instead of the retired native About dialog). */
  focusSection: SettingsSection | null
  /** Current General-section language selection, seeded once at app
   * startup from preferences (App.tsx) and set optimistically on change. */
  languageSetting: LanguageSetting
  /** Issue #38 (v1.2.3): the Appearance-section color theme — seeded once
   * at app startup from preferences (App.tsx, which also applies it to the
   * root node) and set optimistically on change. */
  colorThemeSetting: ColorTheme
  /** Issue #21: the effective sample rate shown in the Audio section —
   * the saved preference, or 48000 when unset. Seeded once at app startup
   * from the same preferences read as the language, then updated
   * optimistically on change. */
  sampleRateSetting: number
  /** #58: the App-global node identity of the Node section — the saved
   * preference or '' when never set. Seeded once at app startup from the
   * same preferences read, then updated optimistically on change; the
   * 「设置节点」gate reads completeness from these. */
  nodeNameSetting: string
  /** #58: the telematic hub's full URL ('' = never set). See
   * `nodeNameSetting`. */
  hubUrlSetting: string
  /** #58: the hub access token ('' = never set). Stored as its own field
   * in preferences, masked in the UI, never concatenated into the URL. */
  hubTokenSetting: string
  /** #58: telematic room group per project manifest id (the「Room」
   * dropdown's persisted choice). Absent entry = group 1; entries are
   * written by the dropdown and never reset (ADR-0004). */
  hubRooms: Record<string, number>
  /** #58: this machine's hostname — the node-name input's placeholder
   * hint (the operator names nodes after machines). Read once at startup
   * via the OS plugin; '' when unavailable. */
  hostnameHint: string
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  toggleSettings: () => void
  setLanguageSetting: (setting: LanguageSetting) => void
  setColorThemeSetting: (theme: ColorTheme) => void
  setSampleRateSetting: (rate: number) => void
  setNodeNameSetting: (name: string) => void
  setHubUrlSetting: (url: string) => void
  setHubTokenSetting: (token: string) => void
  setHubRooms: (rooms: Record<string, number>) => void
  setHostnameHint: (hostname: string) => void
}

export const useSettingsStore = create<SettingsState>()(set => ({
  settingsOpen: false,
  focusSection: null,
  languageSetting: 'system',
  // Mirrors DEFAULT_COLOR_THEME in lib/color-theme (see the import note).
  colorThemeSetting: 'pond',
  sampleRateSetting: DEFAULT_SAMPLE_RATE,
  nodeNameSetting: '',
  hubUrlSetting: '',
  hubTokenSetting: '',
  hubRooms: {},
  hostnameHint: '',

  openSettings: section =>
    set({ settingsOpen: true, focusSection: section ?? null }),

  closeSettings: () => set({ settingsOpen: false, focusSection: null }),

  toggleSettings: () =>
    set(state =>
      state.settingsOpen
        ? { settingsOpen: false, focusSection: null }
        : { settingsOpen: true, focusSection: null }
    ),

  setLanguageSetting: languageSetting => set({ languageSetting }),

  setColorThemeSetting: colorThemeSetting => set({ colorThemeSetting }),

  setSampleRateSetting: sampleRateSetting => set({ sampleRateSetting }),

  setNodeNameSetting: nodeNameSetting => set({ nodeNameSetting }),

  setHubUrlSetting: hubUrlSetting => set({ hubUrlSetting }),

  setHubTokenSetting: hubTokenSetting => set({ hubTokenSetting }),

  setHubRooms: hubRooms => set({ hubRooms }),

  setHostnameHint: hostnameHint => set({ hostnameHint }),
}))

/**
 * v1.3.0 (#49): render-safe read of the live color theme, for values
 * snapshotted at navigation time (the monitor URL's `?theme=` first
 * frame parameter). Referencing `useSettingsStore.getState()` directly
 * during render trips the react-compiler hook-reference rule, so this
 * plain accessor is the blessed shape for that pattern.
 */
export function currentColorThemeSetting(): ColorTheme {
  return useSettingsStore.getState().colorThemeSetting
}
