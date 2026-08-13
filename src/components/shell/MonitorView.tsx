import { useSessionStore } from '@/store/session-store'
import { HoverSidebar } from './HoverSidebar'

/**
 * Performance view (§10.1): the project's monitor page fills the whole
 * window; the top-center title strip shows "PNDS - <project>" and is the
 * window drag region (§10.1, §9.3 reserves that area in the monitor).
 * The floating sidebar pops in from the left edge (Zen-browser style
 * slide + fade) and slides back out when the pointer leaves.
 */
export function MonitorView() {
  const health = useSessionStore(state => state.health)
  const projectName = useSessionStore(state => state.projectName)
  const lanIp = useSessionStore(state => state.lanIp)
  const reloadNonce = useSessionStore(state => state.monitorReloadNonce)
  // §v1.1.1: browser-style zoom (50–200%), session-only.
  const monitorZoom = useSessionStore(state => state.monitorZoom)
  const scale = monitorZoom / 100
  const monitorPort = health?.scoreServer?.monitorPort
  if (!lanIp || !monitorPort) {
    // Should not happen for a ready session; fail visibly rather than blank.
    return (
      <div className="flex h-screen items-center justify-center text-sm text-muted-foreground">
        Missing monitor address (LAN IP or monitor port unavailable).
      </div>
    )
  }

  return (
    <div className="relative h-screen w-screen overflow-hidden bg-black">
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
        />
      </div>

      {/* Top-center title / window drag region (§10.1) */}
      <div
        data-tauri-drag-region
        className="absolute left-1/2 top-0 z-40 -translate-x-1/2 cursor-default select-none rounded-b-xl bg-black/30 px-5 py-1.5 text-xs font-medium tracking-wide text-white/85 backdrop-blur-md"
      >
        PNDS - {projectName}
      </div>

      <HoverSidebar />
    </div>
  )
}
