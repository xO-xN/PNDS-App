import { useEffect, useState } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Toaster } from 'sonner'
import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { loadAudioPreferences } from '@/lib/audio-prefs'
import { WelcomeScreen } from '@/components/welcome'
import { Sidebar } from './Sidebar'
import { MonitorView } from './MonitorView'
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
  // loadingDone gates the dissolve; if the page renders with a ready session
  // already in store (test escape hatch — real app never does this), skip it.
  const [loadingDone, setLoadingDone] = useState(sessionStatus === 'ready')

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

  // §6.5 / §4.1: restore saved preferences on mount.
  useEffect(() => {
    void loadAudioPreferences().then(prefs => {
      if (prefs?.outputDevice) {
        useSessionStore.getState().setOutputDevice(prefs.outputDevice)
      }
      if (prefs?.recentProjects?.length) {
        const store = useProjectStore.getState()
        for (const p of prefs.recentProjects) store.trustProject(p)
      }
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
        <div className="h-screen w-screen overflow-hidden rounded-2xl">
          <MonitorView />
        </div>
        <Toaster position="bottom-right" />
      </>
    )
  }

  // ── Error ──
  if (sessionStatus === 'error') {
    return (
      <>
        <div className="flex h-screen w-screen overflow-hidden rounded-2xl bg-[#d9d9d9]">
          <Sidebar variant="static" />
          <main className="flex-1 overflow-auto">
            <ErrorScreen />
          </main>
        </div>
        <Toaster position="bottom-right" />
      </>
    )
  }

  // ── Loading / Dissolve (full-screen, no sidebar — Logo is centered) ──
  const loadingPhase =
    sessionStatus === 'starting' || (sessionStatus === 'ready' && !loadingDone)

  if (loadingPhase) {
    return (
      <>
        <div className="h-screen w-screen overflow-hidden rounded-2xl bg-[#d9d9d9]">
          <LoadingScreen onDissolveEnd={() => setLoadingDone(true)} />
        </div>
        <Toaster position="bottom-right" />
      </>
    )
  }

  // ── Welcome (sidebar always open) ──
  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden rounded-2xl bg-[#d9d9d9]">
        <Sidebar variant="static" />
        <main className="flex-1 overflow-auto">
          <WelcomeScreen />
        </main>
      </div>
      <Toaster position="bottom-right" />
    </>
  )
}
