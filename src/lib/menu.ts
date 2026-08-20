/**
 * Application menu builder using Tauri's JavaScript API.
 *
 * PNDS keeps the macOS menu bar available in every state (§10.1): the app
 * menu, plus standard File/Edit/Window submenus for text editing
 * shortcuts. ⌘W and ⌘Q are custom items (their flows confirm with a live
 * session first); the remaining standard items stay predefined.
 *
 * v1.2.0 (issue #13): Settings… ⌘, toggles the in-app settings panel,
 * File > Add Project… ⌘O opens the project folder picker, About routes to
 * the panel's About section (the native dialog is retired), and the dead
 * Window > Zoom item is gone.
 */
import {
  Menu,
  MenuItem,
  Submenu,
  PredefinedMenuItem,
} from '@tauri-apps/api/menu'
import i18n from '@/i18n/config'
import { logger } from '@/lib/logger'
import { promptOpenProject } from '@/lib/open-project'
import { checkForUpdates } from '@/lib/updater'
import { useProjectStore } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { useSessionStore } from '@/store/session-store'
import {
  requestClose,
  requestQuit,
  toggleFullscreen,
} from '@/store/window-store'
import { startRename } from '@/lib/project-rename'
import {
  hasOpenOverlay,
  hasOpenOverlayBesidesSettings,
  isEditableTarget,
} from '@/hooks/use-command-keyboard'
import { toggleMasterMute } from '@/lib/volume-control'

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
        // v1.2.0 (issue #13): About routes to the settings panel's About
        // section — one version surface, app-styled. The native message
        // dialog is retired.
        await MenuItem.new({
          id: 'about',
          text: t('menu.about', { appName: APP_NAME }),
          action: () => useSettingsStore.getState().openSettings('about'),
        }),
        // v1.2.0 (issue #13): macOS-conventional Settings entry; same
        // toggle as the ⌘, keyboard shortcut.
        await MenuItem.new({
          id: 'settings',
          text: t('menu.settings'),
          accelerator: 'Cmd+Comma',
          // Same overlay guard as the ⌘, keyboard entry: never stack the
          // panel on another modal (close/quit confirms).
          action: () => {
            if (hasOpenOverlayBesidesSettings()) return
            useSettingsStore.getState().toggleSettings()
          },
        }),
        await PredefinedMenuItem.new({ item: 'Separator' }),
        await MenuItem.new({
          id: 'check-updates',
          text: t('menu.checkForUpdates'),
          action: () => void checkForUpdates(),
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
        // v1.1.2 T7 (spec issue #11): custom ⌘Q — the predefined Quit item
        // cannot be intercepted, so it is replaced. With a live session an
        // app-styled confirm dialog opens first; otherwise the app exits
        // immediately (no fade — §7.4).
        await MenuItem.new({
          id: 'quit-app',
          text: t('menu.quit', { appName: APP_NAME }),
          accelerator: 'Cmd+Q',
          action: () => void requestQuit(),
        }),
      ],
    })

    const fileSubmenu = await Submenu.new({
      text: t('menu.file'),
      items: [
        // v1.2.0 (issue #13): ⌘O opens the add-project folder picker — the
        // same flow as the sidebar "+" button.
        await MenuItem.new({
          id: 'add-project',
          text: t('menu.addProject'),
          accelerator: 'Cmd+O',
          action: () => void promptOpenProject(),
        }),
        // §v1.1.1: custom ⌘W — the predefined Close Window is non-functional
        // on this window. v1.2.0: with a running project ⌘W closes the
        // project behind the app-styled confirm (the retired plain-Esc
        // flow); everywhere else it keeps the red-light window-close flow.
        await MenuItem.new({
          id: 'close-window',
          text: t('menu.closeWindow'),
          accelerator: 'Cmd+W',
          action: () => {
            if (useSessionStore.getState().sessionStatus === 'ready') {
              useProjectStore.getState().setConfirmCloseProjectOpen(true)
              return
            }
            void requestClose()
          },
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
        await PredefinedMenuItem.new({ item: 'Separator' }),
        // v1.1.2 T6: ⌘R rename — same action and guards as the keyboard
        // entry (spec issue #10: 同加速键、单一触发源). The native
        // accelerator consumes ⌘R before the webview, so the menu path
        // needs the same text-input / open-overlay escapes.
        await MenuItem.new({
          id: 'rename-project',
          text: t('menu.renameProject'),
          accelerator: 'Cmd+R',
          action: () => {
            if (hasOpenOverlay() || isEditableTarget(document.activeElement))
              return
            startRename()
          },
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
        // v1.2.2 (#30 feedback): ⌘M mute. The accelerator exists to CLAIM
        // the key from macOS's native hide/minimize — like ⌘Q, the native
        // path is replaced, not layered on. Unlike ⌘R it carries no
        // text-input/overlay guards: mute is a pure audio mutation (no UI
        // opens), and emergency silence should work under any overlay.
        // No-op unless the volume can act (volumeAdjustable inside).
        await MenuItem.new({
          id: 'mute-toggle',
          text: t('menu.mute'),
          accelerator: 'Cmd+M',
          action: () => toggleMasterMute(),
        }),
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
        // v1.2.0 (issue #13): the predefined Maximize ("Zoom") item is
        // dropped — it does nothing on this undecorated window.
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
