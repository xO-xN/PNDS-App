import { useEffect } from 'react'
import { onOpenBundle } from '@/lib/events'
import { getCurrentWebviewWindow } from '@tauri-apps/api/webviewWindow'
import {
  buildAppMenu,
  setupMenuLanguageListener,
  setupMenuStateListener,
} from './lib/menu'
import { setupHelpWindowBridge } from './lib/help-window'
import { startBootUpdateCheck } from './lib/updater'
import { runWebKitBaselineCheck } from './lib/webkit-baseline'
import { bootCheckRenderer } from './store/updater-store'
import {
  initializeLanguage,
  languageSettingFromPrefs,
} from './i18n/language-init'
import { hostname } from '@tauri-apps/plugin-os'
import { logger } from './lib/logger'
import { commands } from './lib/tauri-bindings'
import { DEFAULT_SAMPLE_RATE } from './lib/preferences'
import {
  colorThemeFromPrefs,
  setColorThemeAttribute,
  syncWindowCorners,
} from './lib/color-theme'
import { drainPendingBundleOpens } from './lib/bundle-project'
import { handleDroppedPaths } from './lib/drag-drop'
import {
  initWindowState,
  markQuitting,
  fadeInWindow,
} from './store/window-store'
import { useSettingsStore } from './store/settings-store'
import './App.css'
import {
  AppShell,
  CloseConfirmDialog,
  QuitConfirmDialog,
  UpdaterFailureDialog,
  WebKitBaselineDialog,
} from './components/shell'
import { SettingsPanel } from './components/settings'
import { ThemeProvider } from './components/ThemeProvider'
import { ErrorBoundary } from './components/ErrorBoundary'

function App() {
  // Initialize menu, language, updater, and window state on startup
  useEffect(() => {
    logger.info('🚀 PNDS starting up')

    initWindowState()

    // v1.4.2 (#110): the WebKit baseline gate — the system Safari (and
    // with it the WebKit this UI renders on) must reach the 16.4
    // baseline; below it, the App-styled dialog states the problem and
    // the update path. Met or unknown both stay silent.
    void runWebKitBaselineCheck()

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
        // v1.2.3 (issue #38): apply the saved color theme to the root node
        // and seed the Appearance-section selection from the same read.
        // Unknown or not-yet-shipped values fall back to Pond, so an
        // error read also lands on the default rather than no attribute.
        const colorTheme = colorThemeFromPrefs(
          result.status === 'ok' ? result.data.colorTheme : null
        )
        // #41: Brutal squares the native window corners — set the mask
        // before the attribute so the native edge never lags the CSS.
        await syncWindowCorners(colorTheme)
        setColorThemeAttribute(colorTheme)
        useSettingsStore.getState().setColorThemeSetting(colorTheme)
        // Issue #21: seed the Audio-section rate from the same read — the
        // effective rate (preference ?? 48000) the select shows on open.
        if (result.status === 'ok') {
          useSettingsStore
            .getState()
            .setSampleRateSetting(result.data.sampleRate ?? DEFAULT_SAMPLE_RATE)
          // #58: seed the Node section's config from the same read — the
          // 「设置节点」gate reads completeness from these, so the gate is
          // armed as soon as the app comes up. The generated binding type
          // is Partial, so drop undefined room entries on the way in.
          useSettingsStore
            .getState()
            .setNodeNameSetting(result.data.nodeName ?? '')
          useSettingsStore.getState().setHubUrlSetting(result.data.hubUrl ?? '')
          useSettingsStore
            .getState()
            .setHubTokenSetting(result.data.hubToken ?? '')
          const hubRooms: Record<string, number> = {}
          for (const [projectId, group] of Object.entries(
            result.data.hubRooms ?? {}
          )) {
            if (group) hubRooms[projectId] = group
          }
          useSettingsStore.getState().setHubRooms(hubRooms)
        }
        // #58: the node-name input's placeholder hints this machine's
        // hostname — operators name nodes after machines. Best-effort.
        try {
          useSettingsStore.getState().setHostnameHint((await hostname()) ?? '')
        } catch (error) {
          logger.warn('Failed to read hostname for the node hint', { error })
        }
        await buildAppMenu()
        logger.debug('Application menu built')
        setupMenuLanguageListener()
        // v1.3.0 (#52): the Window menu's address segment follows the
        // selected project and the LAN choice — same whole-menu rebuild.
        setupMenuStateListener()
        // v1.3.0 (#56): an open help center live-follows the app —
        // language switches and Appearance theme changes are pushed to
        // it, and its boot handshake replays the last navigate target.
        setupHelpWindowBridge()
      } catch (error) {
        logger.warn('Failed to initialize language or menu', { error })
      } finally {
        // v1.3.0 (#51): cold-start reveal. The window is created hidden
        // (tauri.conf.json visible:false) so its first visible frame is
        // already themed — dark users never see the Pond default
        // first. The reveal is gated on the theme having landed above;
        // it runs even when initialization failed (the DOM then keeps
        // its Pond default, still a themed paint, and the Rust-side
        // backstop would force-show anyway — just far later).
        await fadeInWindow()
      }
    }

    void initLanguageAndMenu()

    logger.info('App environment', {
      isDev: import.meta.env.DEV,
      mode: import.meta.env.MODE,
    })

    // v1.3.2 (#74): the boot auto-check lives in the updater module — App
    // only schedules it and cancels on unmount. v1.4.3 (#121): check-only
    // and completely silent — a found update persists into the updater
    // store for the starting page's notice; failures and offline render
    // nothing (a venue that cannot reach GitHub is the norm).
    const cancelBootUpdateCheck = startBootUpdateCheck(bootCheckRenderer)
    return () => {
      cancelBootUpdateCheck()
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
    const offOpenBundle = onOpenBundle(() => {
      void drainPendingBundleOpens()
    })
    void drainPendingBundleOpens()
    return () => {
      offOpenBundle()
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
        {/* v1.4.0 (#60): manual update-check failures land on the
            App-styled dialog — same rule (boot failures are silent,
            #121). */}
        <UpdaterFailureDialog />
        {/* v1.4.2 (#110): system WebKit below the Safari 16.4 baseline —
            same rule, mounted outside AppShell. */}
        <WebKitBaselineDialog />
        {/* v1.2.0 (issue #13): the settings panel — reachable in every
            window state, like the confirm dialogs above. */}
        <SettingsPanel />
      </ThemeProvider>
    </ErrorBoundary>
  )
}

export default App
