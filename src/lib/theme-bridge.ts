/**
 * v1.2.3 (#44): the theme bridge — pushes the App's current color theme
 * into the project's monitor iframe over cross-origin `postMessage`.
 *
 * The monitor page is an out-of-process, cross-origin iframe; the App can
 * neither inject nor rewrite its DOM. The message protocol below is the
 * one supported channel, and it is OPTIONAL for projects: a page that
 * never listens behaves exactly as before. See the runtime
 * contract §11 (theme push) for the contract.
 */

/** The semantic token subset offered to projects (kebab-case names). */
export const THEME_PALETTE_TOKENS = [
  'bg',
  'sidebar-bg',
  'card',
  'pill',
  'accent',
  'accent-hover',
  'accent-foreground',
  'text',
  'text-secondary',
  'danger',
  'danger-hover',
  'danger-foreground',
  'warning',
  'warning-hover',
  'warning-foreground',
] as const

export type ThemePalette = Record<(typeof THEME_PALETTE_TOKENS)[number], string>

export const THEME_MESSAGE_TYPE = 'pnds:theme'
export const THEME_MESSAGE_VERSION = 1

/** The message shape App → monitor iframe (contract: spec §5.3). */
export interface ThemeMessage {
  type: typeof THEME_MESSAGE_TYPE
  version: number
  /** Theme name (e.g. "brutal") — for projects wanting whole-design forks. */
  theme: string
  /** Final token values — most projects consume these and nothing else. */
  palette: ThemePalette
}

/**
 * Reads the live palette off the document root. The single source of
 * truth stays `theme-variables.css` (selected by `data-color-theme`) —
 * the App never maintains a second color table. Computed values are
 * returned verbatim (trimmed); a token missing from a theme reads as ''.
 */
export function readThemePalette(
  root: HTMLElement = document.documentElement
): ThemePalette {
  const styles = getComputedStyle(root)
  const palette = {} as ThemePalette
  for (const token of THEME_PALETTE_TOKENS) {
    palette[token] = styles.getPropertyValue(`--pnds-${token}`).trim()
  }
  return palette
}

export function buildThemeMessage(
  theme: string,
  palette: ThemePalette
): ThemeMessage {
  return {
    type: THEME_MESSAGE_TYPE,
    version: THEME_MESSAGE_VERSION,
    theme,
    palette,
  }
}

/**
 * Sends the current theme into the monitor iframe. Delivery is
 * best-effort with "latest value wins" semantics — the App re-pushes on
 * iframe load, theme changes and window focus (a suspended OOPIF drops
 * messages), and the page must apply the message idempotently. Never
 * throws: a bridge failure must never affect the show.
 *
 * `targetOrigin` is the monitor's exact origin — never `*`.
 */
export function pushThemeToFrame(
  frame: HTMLIFrameElement | null,
  targetOrigin: string,
  theme: string
): boolean {
  const contentWindow = frame?.contentWindow
  if (!contentWindow) return false
  try {
    contentWindow.postMessage(
      buildThemeMessage(theme, readThemePalette()),
      targetOrigin
    )
    return true
  } catch {
    return false
  }
}
