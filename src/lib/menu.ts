/**
 * Application menu builder using Tauri's JavaScript API.
 *
 * PNDS keeps the macOS menu bar available in every state (§10.1): the app
 * menu, plus standard File/Edit/Window submenus for ⌘W, ⌘Q, ⌘M and text
 * editing shortcuts. All standard items are predefined (native behavior).
 */
import {
  Menu,
  MenuItem,
  Submenu,
  PredefinedMenuItem,
} from '@tauri-apps/api/menu'
import { check } from '@tauri-apps/plugin-updater'
import { message } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { useSessionStore } from '@/store/session-store'
import { requestClose, toggleFullscreen } from '@/store/window-store'

const APP_NAME = 'PNDS'

/**
 * Build and set the application menu with translated labels.
 */
export async function buildAppMenu(): Promise<Menu> {
  const t = i18n.t.bind(i18n)

  try {
    const appSubmenu = await Submenu.new({
      text: APP_NAME,
      items: [
        await MenuItem.new({
          id: 'about',
          text: t('menu.about', { appName: APP_NAME }),
          action: handleAbout,
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({
          id: 'check-updates',
          text: t('menu.checkForUpdates'),
          action: handleCheckForUpdates,
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({
          item: 'Hide',
          text: t('menu.hide', { appName: APP_NAME }),
        }),
        await PredefinedMenuItem.new({
          item: 'HideOthers',
          text: t('menu.hideOthers'),
        }),
        await PredefinedMenuItem.new({
          item: 'ShowAll',
          text: t('menu.showAll'),
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({
          item: 'Quit',
          text: t('menu.quit', { appName: APP_NAME }),
        }),
      ],
    })

    const fileSubmenu = await Submenu.new({
      text: t('menu.file'),
      items: [
        // §v1.1.1: custom ⌘W — the predefined Close Window is non-functional
        // on this window. Shares the red-light close flow (confirm + stop
        // session + fade-hide; the app keeps running).
        await MenuItem.new({
          id: 'close-window',
          text: t('menu.closeWindow'),
          accelerator: 'Cmd+W',
          action: () => void requestClose(),
        }),
      ],
    })

    const editSubmenu = await Submenu.new({
      text: t('menu.edit'),
      items: [
        await PredefinedMenuItem.new({ item: 'Undo', text: t('menu.undo') }),
        await PredefinedMenuItem.new({ item: 'Redo', text: t('menu.redo') }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await PredefinedMenuItem.new({ item: 'Cut', text: t('menu.cut') }),
        await PredefinedMenuItem.new({ item: 'Copy', text: t('menu.copy') }),
        await PredefinedMenuItem.new({ item: 'Paste', text: t('menu.paste') }),
        await PredefinedMenuItem.new({
          item: 'SelectAll',
          text: t('menu.selectAll'),
        }),
      ],
    })

    // §v1.1.1: browser-style monitor controls. Zoom only acts while the
    // session is ready (the store actions no-op otherwise).
    const viewSubmenu = await Submenu.new({
      text: t('menu.view'),
      items: [
        await MenuItem.new({
          id: 'zoom-in',
          text: t('menu.zoomIn'),
          accelerator: 'Cmd+=',
          action: () => useSessionStore.getState().zoomIn(),
        }),
        await MenuItem.new({
          id: 'zoom-out',
          text: t('menu.zoomOut'),
          accelerator: 'Cmd+-',
          action: () => useSessionStore.getState().zoomOut(),
        }),
        await MenuItem.new({
          id: 'actual-size',
          text: t('menu.actualSize'),
          accelerator: 'Cmd+0',
          action: () => useSessionStore.getState().resetZoom(),
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({
          id: 'reload-monitor',
          text: t('menu.reloadMonitor'),
          accelerator: 'Cmd+Shift+R',
          action: () => {
            const session = useSessionStore.getState()
            if (session.sessionStatus === 'ready') {
              session.bumpMonitorReload()
            }
          },
        }),
      ],
    })

    const windowSubmenu = await Submenu.new({
      text: t('menu.window'),
      items: [
        // §v1.1.1: the dead Minimize item is dropped (⌘H covers hiding).
        await PredefinedMenuItem.new({
          item: 'Maximize',
          text: t('menu.zoom'),
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        // §7.4: the single fullscreen action — same handler as ⌃⌘F and
        // the sidebar button.
        await MenuItem.new({
          id: 'toggle-fullscreen',
          text: t('menu.enterFullScreen'),
          accelerator: 'Ctrl+Cmd+F',
          action: () => void toggleFullscreen(),
        }),
      ],
    })

    const menu = await Menu.new({
      items: [appSubmenu, fileSubmenu, editSubmenu, viewSubmenu, windowSubmenu],
    })

    await menu.setAsAppMenu()
    logger.info('Application menu built successfully')
    return menu
  } catch (error) {
    logger.error('Failed to build application menu', { error })
    throw error
  }
}

/**
 * Set up a listener to rebuild the menu when the language changes.
 * Returns an unsubscribe function for cleanup.
 */
export function setupMenuLanguageListener(): () => void {
  const handler = async () => {
    logger.info('Language changed, rebuilding menu')
    try {
      await buildAppMenu()
    } catch (error) {
      logger.error('Failed to rebuild menu on language change', { error })
    }
  }
  i18n.on('languageChanged', handler)
  return () => i18n.off('languageChanged', handler)
}

async function handleAbout(): Promise<void> {
  await message(
    `${APP_NAME} ${__APP_VERSION__}\nPlatform for Networked Digital Score`,
    {
      title: `About ${APP_NAME}`,
      kind: 'info',
    }
  )
}

async function handleCheckForUpdates(): Promise<void> {
  logger.info('Check for Updates menu item clicked')
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
