import ReactDOM from 'react-dom/client'
import './App.css'
import { HelpCenterApp } from '@/components/help/HelpCenter'
import { colorThemeFromPrefs, setColorThemeAttribute } from '@/lib/color-theme'
import { suppressDefaultContextMenu } from '@/lib/context-menu'
import type { HelpTarget } from '@/lib/help-window'
import { commands } from '@/lib/tauri-bindings'
import { initializeLanguage } from '@/i18n/language-init'

/**
 * v1.3.0 (#56): the help center window's entry — a SECOND, minimal webview
 * page (vite multi-page: help.html), not the main app shell. It mirrors
 * App.tsx's anti-flash boot (#51): the window is created hidden, the
 * saved color theme lands on the root node BEFORE the first paint, and
 * HelpCenterApp reveals the window (fade-in) once its content — or its
 * error state — is ready. Nothing from the main app (stores, menus,
 * session machinery) boots here.
 *
 * The target the opener encoded in the URL (?doc=<id> / ?search=1)
 * decides the landing view; later navigations arrive as events.
 */

// Same right-click policy as the main window (see lib/context-menu.ts).
suppressDefaultContextMenu()

function parseInitialTarget(): HelpTarget | undefined {
  const params = new URLSearchParams(window.location.search)
  const docId = params.get('doc')
  if (docId !== null) return { kind: 'doc', docId }
  if (params.get('search') === '1') return { kind: 'search' }
  return undefined
}

async function boot(): Promise<void> {
  let language: string | null = null
  let colorTheme: string | null = null
  const result = await commands.loadPreferences()
  if (result.status === 'ok') {
    language = result.data.language ?? null
    colorTheme = result.data.colorTheme ?? null
  }
  // An error read falls back to Pond (colorThemeFromPrefs' default)
  // — still a themed paint, never a white flash.
  setColorThemeAttribute(colorThemeFromPrefs(colorTheme))
  await initializeLanguage(language)
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <HelpCenterApp initialTarget={parseInitialTarget()} />
  )
}

void boot()
