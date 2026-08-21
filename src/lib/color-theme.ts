import { logger } from '@/lib/logger'
import { updatePreferences } from '@/lib/preferences'
import { useSettingsStore } from '@/store/settings-store'

/**
 * v1.2.3 (issue #38 / spec #36): the app color theme. A theme is one
 * complete token set in theme-variables.css selected by the root node's
 * `data-color-theme` attribute — this module owns that attribute.
 *
 * T2 ships the two light themes; the persisted enum also carries
 * stage/midnight/glass (validated in Rust) for the later v1.2.3 tickets,
 * and `colorThemeFromPrefs` maps anything this build cannot render back
 * to Lavender, so a preference from a newer App never renders wrong.
 */

/** The themes this build implements (the settings panel's offer). */
export type ColorTheme = 'lavender' | 'sand'

export interface ColorThemeOption {
  value: ColorTheme
  /** Accent swatch shown next to the settings select (spec #36 story 11). */
  accent: string
}

/** The Appearance section's list, in display order. The accent hexes
 *  mirror each theme's `--pnds-accent` in theme-variables.css — a preview
 *  swatch cannot read the token (it must render before/independent of the
 *  root attribute), so keep the two in sync when adding a theme. */
export const COLOR_THEME_OPTIONS: readonly ColorThemeOption[] = [
  { value: 'lavender', accent: '#5a4ff3' },
  { value: 'sand', accent: '#d97706' },
]

export const DEFAULT_COLOR_THEME: ColorTheme = 'lavender'

/**
 * Map the persisted `colorTheme` preference to a theme this build can
 * render: unknown, absent, or not-yet-shipped values (stage, midnight,
 * glass until T3/T4) fall back to Lavender — spec #36 story 10.
 */
export function colorThemeFromPrefs(
  saved: string | null | undefined
): ColorTheme {
  return COLOR_THEME_OPTIONS.some(option => option.value === saved)
    ? (saved as ColorTheme)
    : DEFAULT_COLOR_THEME
}

/** Apply a theme to the document root — the whole switching mechanism. */
export function setColorThemeAttribute(theme: ColorTheme): void {
  document.documentElement.dataset.colorTheme = theme
}

/**
 * Apply an Appearance-section selection — set the root attribute (the UI
 * repaints immediately, session or not), update the settings store, and
 * persist through the serialized preference queue so the choice survives
 * a restart. Mirrors `applyLanguageSetting`: the attribute and store land
 * optimistically; a failed persist is logged but does not revert the UI.
 */
export async function applyColorThemeSetting(theme: ColorTheme): Promise<void> {
  try {
    setColorThemeAttribute(theme)
    useSettingsStore.getState().setColorThemeSetting(theme)
    await updatePreferences({ colorTheme: theme })
    logger.info('Color theme applied', { theme })
  } catch (error) {
    logger.error('Failed to apply color theme', { error, theme })
  }
}
