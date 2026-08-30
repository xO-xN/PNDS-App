import { logger } from '@/lib/logger'
import { commands } from '@/lib/tauri-bindings'
import { updatePreferences } from '@/lib/preferences'
import { useSettingsStore } from '@/store/settings-store'

/**
 * v1.2.3 (issues #38/#40/#41 / spec #36): the app color theme. A theme is
 * one complete token set in theme-variables.css selected by the root
 * node's `data-color-theme` attribute — this module owns that attribute.
 *
 * The four solid themes ship in T2/T4/T5; the persisted enum also carries
 * legacy values (`midnight` — renamed to `brutal`; `lavender` — renamed
 * to `pond` in #91, its display name a release earlier; `glass` from the
 * abandoned liquid-glass ticket), and `colorThemeFromPrefs` maps anything
 * this build cannot render back to Pond, so a preference from a newer or
 * older App never renders wrong.
 */

/** The themes this build implements (the settings panel's offer). */
export type ColorTheme = 'pond' | 'sand' | 'stage' | 'brutal'

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
  { value: 'pond', accent: '#5a4ff3' },
  { value: 'sand', accent: '#d97706' },
  { value: 'stage', accent: '#34d399' },
  { value: 'brutal', accent: '#ff5722' },
]

export const DEFAULT_COLOR_THEME: ColorTheme = 'pond'

/**
 * Persisted values this build renders under a new name — `midnight` was
 * renamed to `brutal` (issue #41's second redirect) and `lavender` to
 * `pond` (#91, the vocabulary-sync follow-up to its display rename); the
 * stored preference migrates silently instead of snapping to the
 * default.
 */
const LEGACY_THEME_NAMES: Record<string, ColorTheme> = {
  midnight: 'brutal',
  lavender: 'pond',
}

/**
 * Map the persisted `colorTheme` preference to a theme this build can
 * render: renamed values map to their successor, unknown/absent/not-yet
 * -shipped values (glass until its ticket lands) fall back to Pond —
 * spec #36 story 10.
 */
export function colorThemeFromPrefs(
  saved: string | null | undefined
): ColorTheme {
  const legacy = saved ? LEGACY_THEME_NAMES[saved] : undefined
  if (legacy) return legacy
  return COLOR_THEME_OPTIONS.some(option => option.value === saved)
    ? (saved as ColorTheme)
    : DEFAULT_COLOR_THEME
}

/** Apply a theme to the document root — the whole switching mechanism. */
export function setColorThemeAttribute(theme: ColorTheme): void {
  document.documentElement.dataset.colorTheme = theme
}

/**
 * Brutal's window is square (#41): the native 16px corner mask
 * (window.rs) drops to 0 while that theme is active. Called BEFORE the
 * root attribute lands so the mask never lags the CSS edge — switching
 * into Brutal squares the mask first, switching away rounds it first.
 * A failure is logged, never thrown: the CSS edge still renders (its
 * own square-corner rule), this only keeps the native edge in step.
 */
export async function syncWindowCorners(theme: ColorTheme): Promise<void> {
  const result = await commands.setWindowCornersSquare(theme === 'brutal')
  if (result.status === 'error') {
    logger.warn('Failed to sync the window corner style', {
      error: result.error,
      theme,
    })
  }
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
    await syncWindowCorners(theme)
    setColorThemeAttribute(theme)
    useSettingsStore.getState().setColorThemeSetting(theme)
    await updatePreferences({ colorTheme: theme })
    logger.info('Color theme applied', { theme })
  } catch (error) {
    logger.error('Failed to apply color theme', { error, theme })
  }
}
