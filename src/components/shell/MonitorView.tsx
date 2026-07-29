import { useState } from 'react'
import { useSessionStore } from '@/store/session-store'
import { Sidebar } from './Sidebar'

/**
 * Performance view (§10.1): the project's monitor page fills the whole
 * window; the PNDS sidebar floats in only when the pointer touches the
 * left edge; the top-center title strip shows "PNDS - <project>" and is
 * the window drag region (§10.1, §9.3 reserves that area in the monitor).
 */
export function MonitorView() {
  const health = useSessionStore(state => state.health)
  const projectName = useSessionStore(state => state.projectName)
  const lanIp = useSessionStore(state => state.lanIp)
  const [sidebarVisible, setSidebarVisible] = useState(false)

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
      <iframe
        src={`http://${lanIp}:${monitorPort}/`}
        title="Project monitor"
        className="absolute inset-0 h-full w-full border-0"
      />

      {/* Top-center title / window drag region (§10.1) */}
      <div
        data-tauri-drag-region
        className="absolute left-1/2 top-0 z-40 -translate-x-1/2 cursor-default select-none rounded-b-xl bg-black/30 px-5 py-1.5 text-xs font-medium tracking-wide text-white/85 backdrop-blur-md"
      >
        PNDS - {projectName}
      </div>

      {/* Left-edge hover zone that reveals the sidebar */}
      <div
        data-testid="sidebar-hover-zone"
        className="absolute left-0 top-0 z-40 h-full w-2"
        onMouseEnter={() => setSidebarVisible(true)}
      />

      {sidebarVisible && (
        <div
          className="absolute left-0 top-0 z-50 h-full"
          onMouseLeave={() => setSidebarVisible(false)}
        >
          <Sidebar
            variant="overlay"
            onRequestClose={() => setSidebarVisible(false)}
          />
        </div>
      )}
    </div>
  )
}
