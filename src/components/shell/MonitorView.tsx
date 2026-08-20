import { useEffect, useRef } from 'react'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { HoverSidebar } from './HoverSidebar'

/**
 * Performance view (§10.1): the project's monitor page fills the whole
 * window; the top-center title strip shows "PNDS - <project>" and is the
 * window drag region (§10.1, §9.3 reserves that area in the monitor).
 * The floating sidebar pops in from the left edge (Zen-browser-style
 * slide + fade) and slides back out when the pointer leaves.
 */
export function MonitorView() {
  const hostRef = useRef<HTMLDivElement>(null)
  const health = useSessionStore(state => state.health)
  const projectName = useSessionStore(state => state.projectName)
  const currentPath = useProjectStore(state => state.currentProject?.path)
  // v1.1.2 T6: a custom display name (spec issue #10) wins over the
  // manifest name the session reports.
  const displayOverride = useProjectStore(state =>
    currentPath ? state.projectDisplayNames[currentPath] : undefined
  )
  const lanIp = useSessionStore(state => state.lanIp)
  const reloadNonce = useSessionStore(state => state.monitorReloadNonce)
  // §v1.1.1: browser-style zoom (50–200%), session-only.
  const monitorZoom = useSessionStore(state => state.monitorZoom)
  const scale = monitorZoom / 100
  const monitorPort = health?.scoreServer?.monitorPort

  // WKWebView hands the keyboard first responder to a freshly loaded
  // out-of-process iframe when no element in the main frame holds focus.
  // The window-level shortcuts (⌘ layer, Esc) then go dead until the next
  // click — most visibly on the first project opened after launch, the
  // only session entered without a host element ever being focused.
  // Focusing the host root on mount and after every monitor load/reload
  // keeps the shell's keyboard layer alive; the monitor page is
  // display-only here, so nothing usable loses focus.
  const reclaimKeyboardFocus = () => {
    window.focus()
    hostRef.current?.focus()
  }
  useEffect(() => {
    reclaimKeyboardFocus()
  }, [])
  // v1.2.2 (user report on #29): switching to another desktop and back can
  // hand the first responder to the monitor iframe again — every
  // window-level key (the ⌘ layer above all) then goes dead until the
  // next click. Reclaim on focus/visibility regain, but only when
  // nothing meaningful holds focus: never steal from a sidebar input or
  // an open dialog.
  useEffect(() => {
    const reclaimIfLost = () => {
      const active = document.activeElement
      if (
        active === null ||
        active === document.body ||
        active instanceof HTMLIFrameElement
      ) {
        reclaimKeyboardFocus()
      }
    }
    const handleVisibility = () => {
      if (!document.hidden) reclaimIfLost()
    }
    window.addEventListener('focus', reclaimIfLost)
    document.addEventListener('visibilitychange', handleVisibility)
    return () => {
      window.removeEventListener('focus', reclaimIfLost)
      document.removeEventListener('visibilitychange', handleVisibility)
    }
  }, [])

  if (!lanIp || !monitorPort) {
    // Should not happen for a ready session; fail visibly rather than blank.
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Missing monitor address (LAN IP or monitor port unavailable).
      </div>
    )
  }

  return (
    <div
      ref={hostRef}
      tabIndex={-1}
      data-testid="monitor-host"
      className="relative h-screen w-screen overflow-hidden bg-black outline-none"
    >
      {/* §v1.1.1: browser-style zoom. CSS `zoom` does not visually scale a
          cross-origin iframe (rendered out-of-process) in WKWebView, so the
          wrapper is scaled with a compositing transform and sized inversely
          (100/scale %) — the standard extension-style zoom. transform-origin
          top-left keeps the top-left pinned; the outer overflow-hidden clips
          the overflow. The title strip and hover sidebar are siblings and
          stay at 100%. */}
      <div
        className="h-full w-full"
        style={{
          width: `${100 / scale}%`,
          height: `${100 / scale}%`,
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
        }}
      >
        <iframe
          key={reloadNonce}
          src={`http://${lanIp}:${monitorPort}/`}
          title="Project monitor"
          className="block h-full w-full border-0"
          onLoad={reclaimKeyboardFocus}
        />
      </div>

      {/* Top-center title / window drag region (§10.1) */}
      <div
        data-tauri-drag-region
        className="absolute left-1/2 top-0 z-40 -translate-x-1/2 cursor-default select-none rounded-b-xl bg-black/30 px-5 py-1.5 text-xs font-medium tracking-wide text-white/85 backdrop-blur-md"
      >
        PNDS - {displayOverride ?? projectName}
      </div>

      <HoverSidebar />
    </div>
  )
}
