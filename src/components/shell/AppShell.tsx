import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Toaster } from 'sonner'
import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { loadAudioPreferences } from '@/lib/audio-prefs'
import { WelcomeScreen } from '@/components/welcome'
import { Sidebar } from './Sidebar'
import { MonitorView } from './MonitorView'
import { LoadingScreen } from './LoadingScreen'
import { ErrorScreen } from './ErrorScreen'

/**
 * Application shell (§10.1): routes between the four window states —
 * Welcome and Loading share the "sidebar + main" layout with the sidebar
 * always open (§10.4, Figma); Running is the full-window monitor with the
 * hover-in sidebar; Error stands alone. Session status drives transitions.
 *
 * The `pnds:session` subscription lives here because the shell is always
 * mounted — putting it in a routed child would drop backend events during
 * view transitions (e.g. Welcome → Loading → Running).
 */
export function AppShell() {
  const sessionStatus = useSessionStore(state => state.sessionStatus)

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

  // §6.5: restore the saved output device (app-local preference).
  useEffect(() => {
    void loadAudioPreferences().then(prefs => {
      if (prefs?.outputDevice) {
        useSessionStore.getState().setOutputDevice(prefs.outputDevice)
      }
    })
  }, [])

  if (sessionStatus === 'ready') {
    return (
      <>
        <div className="h-screen w-screen overflow-hidden rounded-[12px]">
          <MonitorView />
        </div>
        <Toaster position="bottom-right" />
      </>
    )
  }

  if (sessionStatus === 'error') {
    return (
      <>
        <div className="flex h-screen w-screen overflow-hidden rounded-[12px] bg-[#d9d9d9]">
          <Sidebar variant="static" />
          <main className="flex-1 overflow-auto">
            <ErrorScreen />
          </main>
        </div>
        <Toaster position="bottom-right" />
      </>
    )
  }

  // Welcome and Loading share the always-open sidebar layout (§10.4).
  return (
    <>
      <div className="flex h-screen w-screen overflow-hidden rounded-[12px] bg-[#d9d9d9]">
        <Sidebar variant="static" />
        <main className="flex-1 overflow-auto">
          {sessionStatus === 'starting' ? <LoadingScreen /> : <WelcomeScreen />}
        </main>
      </div>
      <Toaster position="bottom-right" />
    </>
  )
}
