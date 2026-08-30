import { create } from 'zustand'
import { DEFAULT_SAMPLE_RATE } from '@/lib/preferences'
// Type-only: a runtime import here would cycle (color-theme imports this
// store for applyColorThemeSetting), and the cycle evaluates this module
// while color-theme's constants are still uninitialized.
import type { ColorTheme } from '@/lib/color-theme'

/** The sections of the settings panel (spec issue #12, single-page scroll
 * layout; issue #21 added Audio, issue #38 added Appearance). The Projects
 * history section (#15) was removed after user review — history management
 * lives in the sidebar alone. */
export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'audio'
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
  openSettings: (section?: SettingsSection) => void
  closeSettings: () => void
  toggleSettings: () => void
  setLanguageSetting: (setting: LanguageSetting) => void
  setColorThemeSetting: (theme: ColorTheme) => void
  setSampleRateSetting: (rate: number) => void
}

export const useSettingsStore = create<SettingsState>()(set => ({
  settingsOpen: false,
  focusSection: null,
  languageSetting: 'system',
  // Mirrors DEFAULT_COLOR_THEME in lib/color-theme (see the import note).
  colorThemeSetting: 'pond',
  sampleRateSetting: DEFAULT_SAMPLE_RATE,

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
