import ReactDOM from 'react-dom/client'
import './App.css'
import { ProjectionApp } from '@/components/projection/ProjectionApp'
import { colorThemeFromPrefs, setColorThemeAttribute } from '@/lib/color-theme'
import { suppressDefaultContextMenu } from '@/lib/context-menu'
import { commands } from '@/lib/tauri-bindings'
import { initializeLanguage } from '@/i18n/language-init'

/**
 * v1.5.0 (#129): the projection window's entry — the venue screen's own
 * minimal webview page (vite multi-page: projection.html), mirroring
 * App.tsx's anti-flash boot (#51): the window is created hidden, the
 * saved color theme lands on the root node BEFORE the first paint, and
 * ProjectionApp reveals the window (fade-in) once its first session
 * snapshot — or the restore's failure — has settled. Nothing from the
 * main app boots here (ADR-0006 thin root: no AppShell, no preferences
 * writes, no utilities seeding, no command keyboard); the session facts
 * arrive through the broadcast snapshot events and getSessionState.
 */

// Same right-click policy as every window (see lib/context-menu.ts).
suppressDefaultContextMenu()

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
    <ProjectionApp />
  )
}

void boot()
