import { useEffect } from 'react'
import { ThemeProviderContext, type Theme } from '@/lib/theme-context'

/**
 * Theme provider.
 *
 * PNDS is a fixed-light application: every surface uses the app's own
 * `--pnds-*` palette (see theme-variables.css), which has no dark variant,
 * and the remaining shadcn surfaces (e.g. popover menus) read `--popover`
 * etc. Those variables are only defined for the light theme — the `.dark`
 * class from a system-wide dark appearance would repaint the menus black
 * while the rest of the app stays light.
 *
 * So instead of following the OS (`system`), this provider always pins the
 * light theme. The persisted `theme` preference and the `theme-changed`
 * event are ignored (kept out to avoid implying the UI supports dark).
 *
 * Color themes (v1.2.3, issues #38/#40) are a separate axis handled by
 * src/lib/color-theme.ts: the root node's `data-color-theme` attribute
 * swaps the whole token set (two light, two dark). This light/dark class
 * axis stays pinned — the shadcn `.dark` variant is not how the app's
 * dark themes render; they remap the same light-variant tokens.
 */
export function ThemeProvider({
  children,
  ...props
}: {
  children: React.ReactNode
}) {
  useEffect(() => {
    const root = window.document.documentElement
    root.classList.remove('light', 'dark')
    root.classList.add('light')
  }, [])

  const value = {
    theme: 'light' as Theme,
    setTheme: () => {
      // No-op: the app is fixed light.
    },
  }

  return (
    <ThemeProviderContext.Provider {...props} value={value}>
      {children}
    </ThemeProviderContext.Provider>
  )
}
