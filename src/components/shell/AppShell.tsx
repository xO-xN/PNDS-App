import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Toaster } from 'sonner'
import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useWindowStore } from '@/store/window-store'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { loadAudioPreferences } from '@/lib/audio-prefs'
import { ensureUtilitiesFolder } from '@/lib/utilities-folder'
import { cn } from '@/lib/utils'
import { WelcomeScreen } from '@/components/welcome'
import { Sidebar } from './Sidebar'
import { MonitorView } from './MonitorView'
import { HoverSidebar } from './HoverSidebar'
import { LoadingScreen } from './LoadingScreen'
import { ErrorScreen } from './ErrorScreen'

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
    void commands.getSessionState().then(result => {
      if (result.status === 'ok') {
        useSessionStore.getState().applySnapshot(result.data)
      }
    })
    return () => {
      void unlisten.then(off => off())
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
    void loadAudioPreferences().then(async prefs => {
      if (prefs?.outputDevice) {
        useSessionStore.getState().setOutputDevice(prefs.outputDevice)
      }
      if (prefs?.recentProjects?.length) {
        const store = useProjectStore.getState()
        for (const p of prefs.recentProjects) store.trustProject(p)
      }
      // v1.1.2: folder structure; old preference files simply lack the
      // field (Rust serde default) and restore as no folders.
      if (prefs?.projectFolders?.length) {
        useProjectStore.getState().setProjectFolders(prefs.projectFolders)
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

  // ── Running (dissolve must have finished) ──
  if (sessionStatus === 'ready' && loadingDone) {
    return (
      <>
        <div
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
