import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Toaster } from 'sonner'
import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useWindowStore } from '@/store/window-store'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { loadPreferences } from '@/lib/preferences'
import { ensureUtilitiesFolder } from '@/lib/utilities-folder'
import { cn } from '@/lib/utils'
import { WelcomeScreen } from '@/components/welcome'
import { Sidebar } from './Sidebar'
import { MonitorView } from './MonitorView'
import { HoverSidebar } from './HoverSidebar'
import { LoadingScreen } from './LoadingScreen'
import { ErrorScreen } from './ErrorScreen'

/** Pulls the authoritative session state from Rust into the store — the
 * mount restore, the visibility/focus catch-ups and the loading poll all
 * share this one path (v1.2.2, user reports on #29: occluded-webview
 * event loss). */
function restoreSessionState(): void {
  void commands.getSessionState().then(result => {
    if (result.status === 'ok') {
      useSessionStore.getState().applySnapshot(result.data)
    }
  })
}

/**
 * Application shell (§10.1): routes between the four window states.
 *
 * The dissolve gate (`loadingDone`) keeps the LoadingScreen mounted for a
 * brief moment after the session reaches "ready", so the logo canvas can
 * play its closure animation and fade out while the monitor fades in (§10.3
 * two-phase contract: the dissolve layer overlaps the monitor).
 */
export function AppShell() {
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  // §9.3: identifies the current loading session; a Retry bumps it so the
  // logo canvas remounts and replays from its first stage.
  const runId = useSessionStore(state => state.runId)
  // §7.4: fullscreen has no rounded corners — the window fills the screen.
  const fullscreen = useWindowStore(state => state.fullscreen)
  // loadingDone gates the dissolve; if the page renders with a ready session
  // already in store (test escape hatch — real app never does this), skip it.
  const [loadingDone, setLoadingDone] = useState(sessionStatus === 'ready')

  // v1.1.2: shell-level Cmd keyboard layer (badges, Cmd+1..9, sidebar
  // peek) — registered once, active in every window state (spec issue #4).
  useCommandKeyboard()

  // Mirror the Rust session state: live events + initial restore on mount.
  useEffect(() => {
    const unlisten = listen<SessionSnapshot>('pnds:session', event => {
      useSessionStore.getState().applySnapshot(event.payload)
    })
    restoreSessionState()
    // v1.2.2 (user report on #29): an occluded WKWebView suspends its JS,
    // so `pnds:session` events queue behind the suspension — coming back
    // from another desktop showed the loading screen's last stage until
    // the queued events caught up. Re-fetching on regain makes the shell
    // current the moment the view is visible again.
    const handleVisibility = () => {
      if (!document.hidden) restoreSessionState()
    }
    document.addEventListener('visibilitychange', handleVisibility)
    // The Rust-side regain signal (NSWindowDidBecomeKey) — WKWebView
    // does not reliably surface DOM focus/visibility events for desktop
    // switches, so lib.rs emits this on Focused(true) instead.
    const unlistenFocus = listen('pnds:window-focus', restoreSessionState)
    return () => {
      void unlisten.then(off => off())
      void unlistenFocus.then(off => off())
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  // §7.4: mirror the Rust window state (fullscreen, traffic-light
  // visibility, fade generation). Single direction: Rust → React.
  useEffect(() => {
    const unlisten = listen('pnds:window', event => {
      useWindowStore.getState().applyWindowSnapshot(event.payload as never)
    })
    return () => {
      void unlisten.then(off => off())
    }
  }, [])

  // §6.5 / §4.1: restore saved preferences on mount.
  useEffect(() => {
    void loadPreferences().then(async prefs => {
      if (prefs?.outputDevice) {
        useSessionStore.getState().setOutputDevice(prefs.outputDevice)
      }
      // v1.1.2: the project index — history master list + folder
      // structure. Old preference files simply lack the fields (Rust serde
      // defaults) and restore as an empty index. The bulk restore never
      // writes back; every later structural change persists through the
      // store's own actions.
      const paths = prefs?.recentProjects ?? []
      const folders = prefs?.projectFolders ?? []
      if (paths.length > 0 || folders.length > 0) {
        useProjectStore.getState().restoreProjectIndex(paths, folders)
      }
      // v1.1.2 T6: custom display names (spec issue #10) — same serde
      // default, so old files restore as no overrides. The generated
      // binding type is Partial, so drop undefined entries on the way in.
      if (prefs?.projectDisplayNames) {
        const names: Record<string, string> = {}
        for (const [path, name] of Object.entries(prefs.projectDisplayNames)) {
          if (name) names[path] = name
        }
        useProjectStore.getState().setProjectDisplayNames(names)
      }
      // v1.2.0 (issue #16): manifest-declared names learned at preflight —
      // same serde default and Partial-entry discipline as the overrides.
      if (prefs?.projectManifestNames) {
        const names: Record<string, string> = {}
        for (const [path, name] of Object.entries(prefs.projectManifestNames)) {
          if (name) names[path] = name
        }
        useProjectStore.getState().setManifestProjectNames(names)
      }
      // v1.1.2 T7: after the restore, seed the default Utilities folder
      // (spec issue #11) — a no-op whenever the folder already exists.
      await ensureUtilitiesFolder()
    })
  }, [])

  // Reset the dissolve gate whenever we leave the running/loading state.
  useEffect(() => {
    if (sessionStatus !== 'starting' && sessionStatus !== 'ready') {
      queueMicrotask(() => setLoadingDone(false))
    }
  }, [sessionStatus])

  // v1.2.2 (user retest on #29): while a session loads, poll the
  // authoritative state once a second. Events emitted into the occluded
  // (suspended) webview can be dropped outright — the poll bounds the
  // stall to a second instead of replaying the whole loading animation
  // after the switch back.
  useEffect(() => {
    if (sessionStatus !== 'starting') return
    const id = setInterval(restoreSessionState, 1000)
    return () => clearInterval(id)
  }, [sessionStatus])

  // ── Running (dissolve must have finished) ──
  if (sessionStatus === 'ready' && loadingDone) {
    return (
      <>
        <div
          data-app-frame=""
          className={cn(
            'h-screen w-screen overflow-hidden',
            !fullscreen && 'rounded-[var(--app-corner-radius)]'
          )}
        >
          {/* §7.4: fullscreen toggles dissolve at the NSWindow layer
              (Rust fades the whole window out, macOS switches, window
              fades in). MonitorView is keyed by fullscreen so a
              popped-out overlay sidebar is dropped instantly. */}
          <MonitorView key={fullscreen ? 'fullscreen' : 'windowed'} />
        </div>
        <Toaster position="bottom-right" />
      </>
    )
  }

  // ── Error ──
  if (sessionStatus === 'error') {
    return (
      <>
        <div
          data-app-frame=""
          className={cn(
            'flex h-screen w-screen overflow-hidden bg-(--pnds-bg)',
            !fullscreen && 'rounded-[var(--app-corner-radius)]'
          )}
        >
          {/* §7.4: fullscreen drops the sidebar instantly (no transition);
              the overlay sidebar in MonitorView still pops in on hover. */}
          {!fullscreen && <Sidebar variant="static" />}
          <main className="flex-1 overflow-auto">
            <ErrorScreen />
          </main>
        </div>
        <Toaster position="bottom-right" />
      </>
    )
  }

  // ── Loading / Dissolve (full-screen Logo, no sidebar) ──
  const loadingPhase =
    sessionStatus === 'starting' || (sessionStatus === 'ready' && !loadingDone)

  if (loadingPhase) {
    return (
      <>
        <div
          data-app-frame=""
          className={cn(
            'relative h-screen w-screen overflow-hidden bg-(--pnds-bg)',
            !fullscreen && 'rounded-[var(--app-corner-radius)]'
          )}
        >
          <LoadingScreen
            key={runId}
            onDissolveEnd={() => setLoadingDone(true)}
          />
          {/* §10.1: hover-revealed sidebar stays reachable during loading,
              including fullscreen. */}
          <HoverSidebar />
        </div>
        <Toaster position="bottom-right" />
      </>
    )
  }

  // ── Welcome (sidebar always open, full height) ──
  return (
    <>
      <div
        data-app-frame=""
        className={cn(
          'flex h-screen w-screen overflow-hidden bg-(--pnds-bg)',
          !fullscreen && 'rounded-2xl'
        )}
      >
        {/* Start page: the sidebar stays PERMANENTLY visible, including in
          fullscreen — only loaded sessions retract it on fullscreen. */}
        <Sidebar variant="static" />
        <main className="flex-1 overflow-auto">
          <WelcomeScreen />
        </main>
      </div>
      <Toaster position="bottom-right" />
    </>
  )
}
