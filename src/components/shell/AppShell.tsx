import { useEffect } from 'react'
import { listen } from '@tauri-apps/api/event'
import { Toaster } from 'sonner'
import { commands, type SessionSnapshot } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { WelcomeScreen } from '@/components/welcome'
import { Sidebar } from './Sidebar'
import { MonitorView } from './MonitorView'
import { LoadingScreen } from './LoadingScreen'
import { ErrorScreen } from './ErrorScreen'

/**
 * Application shell (§10.1): routes between the four window states —
 * Welcome (sidebar always open), Loading, Running (monitor + floating
 * sidebar), Error. The session status from the Rust backend drives the
 * transitions; the five-state animation contract arrives in task-6.
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

  return (
    <>
      {sessionStatus === 'starting' ? (
        <LoadingScreen />
      ) : sessionStatus === 'ready' ? (
        <MonitorView />
      ) : sessionStatus === 'error' ? (
        <ErrorScreen />
      ) : (
        <div className="flex h-screen w-screen overflow-hidden bg-gradient-to-br from-[#eef2f8] via-[#e9edf6] to-[#e6ecf4]">
          <Sidebar variant="static" />
          <main className="flex-1 overflow-auto">
            <WelcomeScreen />
          </main>
        </div>
      )}
      <Toaster position="bottom-right" />
    </>
  )
}
