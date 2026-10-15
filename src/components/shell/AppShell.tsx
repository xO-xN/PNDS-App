import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { onWindowState } from '@/lib/events'
import { Toaster } from 'sonner'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useWindowStore } from '@/store/window-store'
import { useCreationStore } from '@/store/creation-store'
import { CreationView } from '@/components/creation'
import { useCreationTestStore } from '@/store/creation-test-store'
import { CreationTestIdle } from '@/components/creation/CreationTestIdle'
import { CreationSplitter } from '@/components/creation/CreationSplitter'
import { useCommandKeyboard } from '@/hooks/use-command-keyboard'
import { loadPreferences } from '@/lib/preferences'
import { ensureUtilitiesFolder } from '@/lib/utilities-folder'
import { cn } from '@/lib/utils'
import { ReadmePanel } from '@/components/readme'
import { DesktopBar } from './DesktopBar'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { useTranslation } from 'react-i18next'
import { MonitorView } from './MonitorView'
import { HoverSidebar } from './HoverSidebar'
import { ResizeGrip } from './ResizeGrip'
import { LoadingScreen } from './LoadingScreen'
import { ErrorScreen } from './ErrorScreen'
import { StopCover } from './StopCover'
import {
  attachSessionSnapshotMirror,
  type SessionSnapshotMirror,
} from '@/lib/session-snapshot-mirror'

/**
 * Application shell (§10.1): routes between the four window states.
 *
 * The dissolve gate (`loadingDone`) keeps the LoadingScreen mounted for a
 * brief moment after the session reaches "ready", so the logo canvas can
 * play its closure animation and fade out while the monitor fades in (§10.3
 * two-phase contract: the dissolve layer overlaps the monitor).
 *
 * v1.3.0 (#50): that overlap is now literal — the ready state mounts the
 * MonitorView (its iframe starts loading immediately) WITH the splash on
 * top, and the splash only cross-fades away once the reveal gate releases
 * (the iframe's own load event, or the timeout backstop). No unloaded
 * iframe can flash between the two layers.
 */
export function AppShell() {
  const { t } = useTranslation()
  const frameRef = useRef<HTMLDivElement>(null)
  const [controlsOpen, setControlsOpen] = useState(false)
  const [introOpen, setIntroOpen] = useState(false)
  const sessionMirror = useRef<SessionSnapshotMirror | null>(null)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  // §9.3: identifies the current loading session; a Retry bumps it so the
  // logo canvas remounts and replays from its first stage.
  const runId = useSessionStore(state => state.runId)
  // §7.4: fullscreen has no rounded corners — the window fills the screen.
  const fullscreen = useWindowStore(state => state.fullscreen)
  const creationActive = useCreationStore(state => state.active)
  const creationWorkspace = useCreationStore(state => state.workspace !== null)
  const monitorExpanded = useCreationTestStore(state => state.expanded)
  // loadingDone gates the dissolve; if the page renders with a ready session
  // already in store (test escape hatch — real app never does this), skip it.
  const [loadingDone, setLoadingDone] = useState(sessionStatus === 'ready')
  // v1.3.0 (user report): a stop just completed — the Welcome below is
  // uncovered through the StopCover fade instead of a cut. The flag is
  // applySnapshot-owned (event context): idle-from-stopping arms it,
  // repeated idle snapshots keep it, any other lifecycle clears it.
  const stopUncoverPending = useSessionStore(state => state.stopUncoverPending)
  // A stop's health mirror decides whether a monitor page lingers: a
  // LIVE session's stopping snapshot still carries it (the outgoing
  // page dissolves under the cover), while a stop of a session that
  // never reached ready (cancel during loading, stop out of error)
  // carries none — no MonitorView must mount for it (its no-address
  // fallback would flash an error text instead of a fade).
  const health = useSessionStore(state => state.health)

  // v1.1.2: shell-level Cmd keyboard layer (badges, Cmd+1..9, sidebar
  // peek) — registered once, active in every window state (spec issue #4).
  useCommandKeyboard()

  // The main window applies runtime facts through the store, preserving
  // its next-start settings and animation gates. The shared mirror owns
  // mount/focus/visibility catch-up and asynchronous response ordering.
  useEffect(() => {
    const mirror = attachSessionSnapshotMirror({
      onSnapshot: snapshot =>
        useSessionStore.getState().applySnapshot(snapshot),
    })
    sessionMirror.current = mirror
    return () => {
      mirror.dispose()
      sessionMirror.current = null
    }
  }, [])

  // §7.4: mirror the Rust window state (fullscreen, traffic-light
  // visibility, fade generation). Single direction: Rust → React.
  useEffect(() => {
    const offWindowState = onWindowState(snapshot =>
      useWindowStore.getState().applyWindowSnapshot(snapshot)
    )
    return () => {
      offWindowState()
    }
  }, [])

  // §6.5 / §4.1: restore saved preferences on mount.
  useEffect(() => {
    void loadPreferences().then(async prefs => {
      if (prefs?.outputDevice) {
        useSessionStore.getState().setOutputDevice(prefs.outputDevice)
      }
      // #147: the persisted LAN choice seeds the session store BEFORE the
      // first address-list refresh (preflight / the Node section) — that
      // refresh keeps a still-valid choice and replaces a gone one with
      // the first current address (never start bound to a dead
      // interface), so the operator's pick survives launches instead of
      // resetting to "nothing selected" (the pre-fix gray Load button).
      if (prefs?.lanIp) {
        useSessionStore.getState().setLanIp(prefs.lanIp)
      }
      // v1.1.2: the project index — history master list + folder
      // structure. Old preference files simply lack the fields (Rust serde
      // defaults) and restore as an empty index. The bulk restore never
      // writes back; every later structural change persists through the
      // store's own actions.
      const paths = prefs?.recentProjects ?? []
      useCreationStore
        .getState()
        .restoreRecent(prefs?.recentCreationProjects ?? [])
      useCreationStore
        .getState()
        .restoreCreationParent(prefs?.lastCreationParent ?? null)
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

  // Reset the dissolve gate whenever we leave the loading/running/
  // stopping lifecycle. Stopping itself KEEPS the flag: a revealed
  // monitor's stop must keep the StopCover (not swap back to a splash),
  // while a never-ready stop keeps its splash — both until the state
  // after the stop sorts them out (idle resets, starting re-loads).
  useEffect(() => {
    if (
      sessionStatus !== 'starting' &&
      sessionStatus !== 'ready' &&
      sessionStatus !== 'stopping'
    ) {
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
    const id = setInterval(() => sessionMirror.current?.restore(), 1000)
    return () => clearInterval(id)
  }, [sessionStatus])

  const monitorVisible =
    sessionStatus === 'ready' ||
    (sessionStatus === 'stopping' && health !== null)
  const preparing = sessionStatus === 'starting' || sessionStatus === 'stopping'
  return (
    <>
      <div
        ref={frameRef}
        data-app-frame=""
        className={cn(
          'desktop-frame relative h-screen w-screen overflow-hidden bg-(--pnds-bg)',
          creationActive && 'creation-shell-frame',
          creationActive && creationWorkspace && 'creation-runtime-frame',
          creationActive && monitorExpanded && 'creation-monitor-expanded',
          !fullscreen && 'rounded-[var(--app-corner-radius)]'
        )}
      >
        {/* Fixed sibling and key: chrome, layout and fullscreen never remount the runtime page. */}
        {monitorVisible && <MonitorView />}
        {creationActive && creationWorkspace && !monitorVisible && (
          <CreationTestIdle />
        )}
        {creationActive && <CreationView />}
        {creationActive && creationWorkspace && (
          <CreationSplitter frame={frameRef} hidden={monitorExpanded} />
        )}
        {!creationActive && !monitorVisible && !preparing && (
          <main className="desktop-performance-main">
            {sessionStatus === 'error' ? <ErrorScreen /> : <ReadmePanel />}
          </main>
        )}
        {!creationActive &&
          !loadingDone &&
          (preparing || sessionStatus === 'ready') && (
            <div className="desktop-runtime-cover absolute inset-0 z-50">
              <LoadingScreen
                key={runId}
                onDissolveEnd={() => setLoadingDone(true)}
              />
            </div>
          )}
        {!creationActive &&
          loadingDone &&
          sessionStatus === 'stopping' &&
          health !== null && <StopCover phase="in" />}
        {!creationActive && !preparing && stopUncoverPending && (
          <StopCover
            phase="out"
            onFadedOut={() => useSessionStore.getState().clearStopUncover()}
          />
        )}
        {!creationActive && (
          <HoverSidebar
            held={controlsOpen || introOpen}
            onShowReadme={() => setIntroOpen(true)}
          />
        )}
        <DesktopBar onPopupOpenChange={setControlsOpen} />
        {!fullscreen && <ResizeGrip />}
      </div>
      <Dialog open={introOpen && !creationActive} onOpenChange={setIntroOpen}>
        <DialogContent className="desktop-intro-dialog">
          <DialogTitle>{t('desktop.projectAbout')}</DialogTitle>
          <div className="relative min-h-0 flex-1 overflow-auto">
            <ReadmePanel />
          </div>
        </DialogContent>
      </Dialog>
      <Toaster
        position="bottom-right"
        style={
          {
            '--normal-bg': 'var(--pnds-card)',
            '--normal-bg-hover': 'var(--pnds-pill-hover)',
            '--normal-text': 'var(--pnds-text)',
            '--normal-border': 'var(--pnds-border)',
          } as CSSProperties
        }
      />
    </>
  )
}
