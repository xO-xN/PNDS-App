import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { buildAppMenu, setupMenuLanguageListener } from './lib/menu'
import {
  initializeLanguage,
  languageSettingFromPrefs,
} from './i18n/language-init'
import { logger } from './lib/logger'
import { commands } from './lib/tauri-bindings'
import { DEFAULT_SAMPLE_RATE } from './lib/preferences'
import {
  applyNativeGlass,
  colorThemeFromPrefs,
  setColorThemeAttribute,
} from './lib/color-theme'
import { drainPendingBundleOpens } from './lib/bundle-project'
import { handleDroppedPaths } from './lib/drag-drop'
import { initWindowState, markQuitting } from './store/window-store'
import { useSettingsStore } from './store/settings-store'
import './App.css'
import {
  AppShell,
  CloseConfirmDialog,
  QuitConfirmDialog,
} from './components/shell'
import { SettingsPanel } from './components/settings'
import { ThemeProvider } from './components/ThemeProvider'
import { ErrorBoundary } from './components/ErrorBoundary'

function App() {
  // Initialize menu, language, updater, and window state on startup
  useEffect(() => {
    logger.info('🚀 PNDS starting up')

    initWindowState()

    // §7.4: ⌘Q must not wait for the fade animation — mark the manager
    // as quitting so in-flight ramps cancel and close hides immediately.
    const onBeforeUnload = () => {
      void markQuitting()
    }
    window.addEventListener('beforeunload', onBeforeUnload)

    const initLanguageAndMenu = async () => {
      try {
        const result = await commands.loadPreferences()
        const savedLanguage =
          result.status === 'ok' ? result.data.language : null

        await initializeLanguage(savedLanguage)
        // Seed the settings panel's General-section selection from the same
        // preferences read (v1.2.0 issue #13); afterwards the store is the
        // single source for that control.
        useSettingsStore
          .getState()
          .setLanguageSetting(languageSettingFromPrefs(savedLanguage))
        // v1.2.3 (issue #41): the Glass gate — macOS 26+ renders it, older
        // systems keep the option disabled and fall a persisted `glass`
        // back to Lavender. Seeded before the theme applies so the two
        // never disagree.
        const glassResult = await commands.supportsLiquidGlass()
        const liquidGlassSupported =
          glassResult.status === 'ok' ? glassResult.data : false
        useSettingsStore
          .getState()
          .setLiquidGlassSupported(liquidGlassSupported)
        // v1.2.3 (issue #38): apply the saved color theme to the root node
        // and seed the Appearance-section selection from the same read.
        // Unknown or not-yet-shipped values fall back to Lavender, so an
        // error read also lands on the default rather than no attribute.
        const colorTheme = colorThemeFromPrefs(
          result.status === 'ok' ? result.data.colorTheme : null,
          liquidGlassSupported
        )
        setColorThemeAttribute(colorTheme)
        if (colorTheme === 'glass') {
          void applyNativeGlass(true)
        }
        useSettingsStore.getState().setColorThemeSetting(colorTheme)
        // Issue #21: seed the Audio-section rate from the same read — the
        // effective rate (preference ?? 48000) the select shows on open.
        if (result.status === 'ok') {
          useSettingsStore
            .getState()
            .setSampleRateSetting(result.data.sampleRate ?? DEFAULT_SAMPLE_RATE)
        }
        await buildAppMenu()
        logger.debug('Application menu built')
        setupMenuLanguageListener()
      } catch (error) {
        logger.warn('Failed to initialize language or menu', { error })
      }
    }

    void initLanguageAndMenu()

    logger.info('App environment', {
      isDev: import.meta.env.DEV,
      mode: import.meta.env.MODE,
    })

    // Auto-updater: check for updates 5 seconds after app loads
    const checkForUpdates = async () => {
      try {
        const update = await check()
        if (update) {
          logger.info(`Update available: ${update.version}`)

          const shouldUpdate = confirm(
            `Update available: ${update.version}\n\nWould you like to install this update now?`
          )

          if (shouldUpdate) {
            try {
              await update.downloadAndInstall(event => {
                switch (event.event) {
                  case 'Started':
                    logger.info(`Downloading ${event.data.contentLength} bytes`)
                    break
                  case 'Progress':
                    logger.info(`Downloaded: ${event.data.chunkLength} bytes`)
                    break
                  case 'Finished':
                    logger.info('Download complete, installing...')
                    break
                }
              })

              const shouldRestart = confirm(
                'Update completed successfully!\n\nWould you like to restart the app now to use the new version?'
              )

              if (shouldRestart) {
                await relaunch()
              }
            } catch (updateError) {
              logger.error(`Update installation failed: ${String(updateError)}`)
              alert(
                `Update failed: There was a problem with the automatic download.\n\n${String(updateError)}`
              )
            }
          }
        }
      } catch (checkError) {
        logger.error(`Update check failed: ${String(checkError)}`)
        // Silent fail for update checks - don't bother user with network issues
      }
    }

    const updateTimer = setTimeout(() => void checkForUpdates(), 5000)
    return () => {
      clearTimeout(updateTimer)
      window.removeEventListener('beforeunload', onBeforeUnload)
    }
  }, [])

  // v1.2.0 (issue #16): `.pnds` files the App was asked to open via macOS
  // file association. The backend queues them and emits this event; the
  // mount-time drain also covers a cold start where the event fired before
  // this listener existed (the drain is atomic, so no double-processing).
  // The drain runs only after the listener is live — an event landing in
  // between would otherwise be missed entirely.
  useEffect(() => {
    const unlisten = listen('pnds:open-bundle', () => {
      void drainPendingBundleOpens()
    })
    void unlisten.then(() => drainPendingBundleOpens())
    return () => {
      void unlisten.then(unlistenFn => unlistenFn())
    }
  }, [])

  // v1.2.0 (issue #16): Finder drag-and-drop — dropping a project folder or
  // a `.pnds` file on the window imports it through the same flows as the
  // ⌘O picker (dragDropEnabled is on; the sidebar's reorder gesture is
  // pointer-based, so the native drop events conflict with nothing).
  useEffect(() => {
    const unlisten = getCurrentWebviewWindow().onDragDropEvent(event => {
      if (event.payload.type === 'drop') {
        void handleDroppedPaths(event.payload.paths)
      }
    })
    return () => {
      void unlisten.then(unlistenFn => unlistenFn())
    }
  }, [])

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppShell />
        {/* §v1.1.1: close-confirm is app-styled, mounted outside AppShell
            so it's reachable in every window state (welcome/loading/monitor). */}
        <CloseConfirmDialog />
        {/* v1.1.2 T7: quit-confirm (⌘Q with a live session) — same rule. */}
        <QuitConfirmDialog />
        {/* v1.2.0 (issue #13): the settings panel — reachable in every
            window state, like the confirm dialogs above. */}
        <SettingsPanel />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
