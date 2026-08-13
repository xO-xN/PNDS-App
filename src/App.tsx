import { useEffect } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { buildAppMenu, setupMenuLanguageListener } from './lib/menu'
import { initializeLanguage } from './i18n/language-init'
import { logger } from './lib/logger'
import { commands } from './lib/tauri-bindings'
import { initWindowState, markQuitting } from './store/window-store'
import './App.css'
import { AppShell, CloseConfirmDialog } from './components/shell'
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

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppShell />
        {/* §v1.1.1: close-confirm is app-styled, mounted outside AppShell
            so it's reachable in every window state (welcome/loading/monitor). */}
        <CloseConfirmDialog />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
