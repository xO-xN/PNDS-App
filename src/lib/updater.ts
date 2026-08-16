/**
 * Shared "Check for Updates" flow (v1.2.0, issue #13): used by the app menu
 * item and the Settings About section. Reports via toast notifications —
 * installing an update keeps the auto-updater flow in App.tsx.
 */
import { check } from '@tauri-apps/plugin-updater'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'

export async function checkForUpdates(): Promise<void> {
  logger.info('Checking for updates')
  try {
    const update = await check()
    if (update) {
      notifications.info(
        'Update Available',
        `Version ${update.version} is available`
      )
    } else {
      notifications.success('Up to Date', 'You are running the latest version')
    }
  } catch (error) {
    logger.error('Update check failed', { error })
    notifications.error('Update Check Failed', 'Could not check for updates')
  }
}
