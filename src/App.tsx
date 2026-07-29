import { useEffect } from 'react'
import { check } from '@tauri-apps/plugin-updater'
import { relaunch } from '@tauri-apps/plugin-process'
import { buildAppMenu, setupMenuLanguageListener } from './lib/menu'
import { initializeLanguage } from './i18n/language-init'
import { logger } from './lib/logger'
import { commands } from './lib/tauri-bindings'
import './App.css'
import { AppShell } from './components/shell'
import { ThemeProvider } from './components/ThemeProvider'
import { ErrorBoundary } from './components/ErrorBoundary'

function App() {
  // Initialize menu, language, and updater on app startup
  useEffect(() => {
    logger.info('🚀 PNDS starting up')

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
    return () => clearTimeout(updateTimer)
  }, [])

  return (
    <ErrorBoundary>
      <ThemeProvider>
        <AppShell />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
