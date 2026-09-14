import ReactDOM from 'react-dom/client'
import './App.css'
import { ProjectionApp } from '@/components/projection/ProjectionApp'
import { colorThemeFromPrefs, setColorThemeAttribute } from '@/lib/color-theme'
import { suppressDefaultContextMenu } from '@/lib/context-menu'
import { commands } from '@/lib/tauri-bindings'
import { clampZoom } from '@/store/session-store'
import { initializeLanguage } from '@/i18n/language-init'

/**
 * v1.5.0 (#129): the projection window's entry — the venue screen's own
 * minimal webview page (vite multi-page: projection.html), mirroring
 * App.tsx's anti-flash boot (#51): the window is created hidden, the
 * saved color theme lands on the root node BEFORE the first paint, and
 * ProjectionApp reveals the window (fade-in) once its first session
 * snapshot — or the restore's failure — has settled. Nothing from the
 * main app boots here (ADR-0006 thin root: no AppShell, no utilities
 * seeding, no command keyboard; and no DIRECT preferences writes — the
 * remembered zoom is reported to the main window, the app's sole
 * writer); the session facts arrive through the broadcast snapshot
 * events and getSessionState.
 */

// Same right-click policy as every window (see lib/context-menu.ts).
suppressDefaultContextMenu()

async function boot(): Promise<void> {
  let language: string | null = null
  let colorTheme: string | null = null
  // The remembered projection zoom (#131 follow-up): read at boot so
  // the FIRST frame already renders at the operator's scale — clamped
  // against a hand-edited preferences file. Never set → 100.
  let projectionZoom: number | null = null
  const result = await commands.loadPreferences()
  if (result.status === 'ok') {
    language = result.data.language ?? null
    colorTheme = result.data.colorTheme ?? null
    projectionZoom = result.data.projectionZoom ?? null
  }
  // An error read falls back to Pond (colorThemeFromPrefs' default)
  // — still a themed paint, never a white flash.
  setColorThemeAttribute(colorThemeFromPrefs(colorTheme))
  await initializeLanguage(language)
  ReactDOM.createRoot(document.getElementById('root') as HTMLElement).render(
    <ProjectionApp initialZoom={clampZoom(projectionZoom ?? 100, 0)} />
  )
}

void boot()
