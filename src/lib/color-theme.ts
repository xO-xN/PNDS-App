import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { updatePreferences } from '@/lib/preferences'
import { useSettingsStore } from '@/store/settings-store'

/**
 * v1.2.3 (issues #38/#40/#41 / spec #36): the app color theme. A theme is
 * one complete token set in theme-variables.css selected by the root node's
 * `data-color-theme` attribute — this module owns that attribute.
 *
 * The four solid themes ship in T2/T4; Glass (T5) renders only where the
 * Rust `supports_liquid_glass` gate says macOS 26+ is present, and
 * `colorThemeFromPrefs` maps anything this build cannot render back to
 * Lavender, so a preference from a newer App never renders wrong.
 */

/** The themes this build implements (the settings panel's offer). */
export type ColorTheme = 'lavender' | 'sand' | 'stage' | 'midnight' | 'glass'

export interface ColorThemeOption {
  value: ColorTheme
  /** Accent swatch shown next to the settings select (spec #36 story 11). */
  accent: string
  /** Offered (and rendered) only on macOS 26+ — drives the disabled
   * option in the Appearance section (issue #41). */
  requiresMacOS26?: boolean
}

/** The Appearance section's list, in display order. The accent hexes
 *  mirror each theme's `--pnds-accent` in theme-variables.css — a preview
 *  swatch cannot read the token (it must render before/independent of the
 *  root attribute), so keep the two in sync when adding a theme. */
export const COLOR_THEME_OPTIONS: readonly ColorThemeOption[] = [
  { value: 'lavender', accent: '#5a4ff3' },
  { value: 'sand', accent: '#d97706' },
  { value: 'stage', accent: '#34d399' },
  { value: 'midnight', accent: '#818cf8' },
  { value: 'glass', accent: '#5a4ff3', requiresMacOS26: true },
]

export const DEFAULT_COLOR_THEME: ColorTheme = 'lavender'

/**
 * Map the persisted `colorTheme` preference to a theme this build can
 * render: unknown values, and Glass on a system without macOS 26, fall
 * back to Lavender — spec #36 stories 5/10. The preference itself is left
 * untouched, so a `glass` value carried to a supported machine works
 * again.
 */
export function colorThemeFromPrefs(
  saved: string | null | undefined,
  liquidGlassSupported = false
): ColorTheme {
  if (saved === 'glass') {
    return liquidGlassSupported ? 'glass' : DEFAULT_COLOR_THEME
  }
  return COLOR_THEME_OPTIONS.some(option => option.value === saved)
    ? (saved as ColorTheme)
    : DEFAULT_COLOR_THEME
}

/** Apply a theme to the document root — the whole switching mechanism. */
export function setColorThemeAttribute(theme: ColorTheme): void {
  document.documentElement.dataset.colorTheme = theme
}

/**
 * Toggle the native liquid-glass dressing (issue #41): NSGlassEffectView
 * behind the webview + a transparent window when on, the default opaque
 * window when off. Errors are logged, never thrown — the CSS layer
 * renders its own translucent approximation either way. Safe to call on
 * every theme change: the Rust side is idempotent.
 */
export async function applyNativeGlass(enabled: boolean): Promise<void> {
  const result = await commands.setLiquidGlass(enabled)
  if (result.status === 'error') {
    logger.warn('Failed to toggle native liquid glass', {
      enabled,
      error: result.error,
    })
  }
}

/**
 * Apply an Appearance-section selection — set the root attribute (the UI
 * repaints immediately, session or not), toggle the native glass dressing
 * to match, update the settings store, and persist through the serialized
 * preference queue so the choice survives a restart. Mirrors
 * `applyLanguageSetting`: attribute/store land optimistically; a failed
 * persist is logged but does not revert the UI.
 *
 * Glass is refused outright below macOS 26 (defense in depth beyond the
 * disabled option — a programmatic call must not render the CSS frosted
 * approximation on an old system, which spec #36 explicitly forbids).
 */
export async function applyColorThemeSetting(theme: ColorTheme): Promise<void> {
  if (theme === 'glass' && !useSettingsStore.getState().liquidGlassSupported) {
    logger.warn('Glass theme requested on an unsupported system — ignored')
    return
  }
  try {
    setColorThemeAttribute(theme)
    // Synchronously, before any await: the select is controlled by this
    // store value, so it must reflect the change in the same tick.
    useSettingsStore.getState().setColorThemeSetting(theme)
    await applyNativeGlass(theme === 'glass')
    await updatePreferences({ colorTheme: theme })
    logger.info('Color theme applied', { theme })
  } catch (error) {
    logger.error('Failed to apply color theme', { error, theme })
  }
}
