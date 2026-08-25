import { useEffect, useMemo, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import {
  useSettingsStore,
  currentColorThemeSetting,
} from '@/store/settings-store'
import { pushThemeToFrame } from '@/lib/theme-bridge'
import { buildMonitorUrl } from '@/lib/monitor-url'
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
  // v1.2.3 (#42): the title names the RUNNING session's project — looked
  // up by the session's own path, so selecting another card (whose
  // rename map entry differs) never retitles the live show.
  const sessionProjectPath = useSessionStore(state => state.sessionProjectPath)
  // v1.1.2 T6: a custom display name (spec issue #10) wins over the
  // manifest name the session reports.
  const displayOverride = useProjectStore(state =>
    sessionProjectPath
      ? state.projectDisplayNames[sessionProjectPath]
      : undefined
  )
  // v1.2.3 (#39/T4): the iframe targets the SESSION's LAN IP (snapshot
  // mirror) — another card's preflight seeding must never retarget or
  // reload the live monitor page. Falls back to the start-config IP only
  // when no snapshot has arrived yet.
  const lanIp = useSessionStore(state => state.sessionLanIp ?? state.lanIp)
  const reloadNonce = useSessionStore(state => state.monitorReloadNonce)
  // §v1.1.1: browser-style zoom (50–200%), session-only.
  const monitorZoom = useSessionStore(state => state.monitorZoom)
  // v1.2.3 (#44): the theme bridge — push the App theme into the monitor
  // iframe so supporting projects (the built-in utilities first) recolor
  // with the App. Optional for projects; never touches the page itself.
  const colorTheme = useSettingsStore(state => state.colorThemeSetting)
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const monitorPort = health?.scoreServer?.monitorPort
  const monitorOrigin = `http://${lanIp}:${monitorPort}`
  // v1.3.0 (#49): `?theme=` rides in the URL as a first-frame parameter,
  // so following pages paint the right colors before any postMessage
  // arrives. The src is snapshotted per iframe NAVIGATION — mount,
  // address change, reload — which is exactly the memo's dep list: a
  // live theme switch must NOT retarget the src (that would reload the
  // live monitor page); the bridge pushes the new theme instead, and
  // the next navigation re-snapshots it. The theme is therefore read
  // from the store inside the memo (latest value), never from the
  // render-time `colorTheme` (which would defrost the snapshot).
  const iframeSrc = useMemo(() => {
    // The nonce only widens the memo: each bump remounts the iframe
    // (its React key), and the fresh load re-snapshots the theme. The
    // address fallbacks never reach the DOM — the guard below replaces
    // the whole view until a real address exists.
    void reloadNonce
    return buildMonitorUrl(lanIp ?? '', monitorPort ?? 0, {
      theme: currentColorThemeSetting(),
    })
  }, [lanIp, monitorPort, reloadNonce])
  // Initial push + re-push on theme switch and monitor reload. (The
  // focus-regain re-push lives in the reclaim effect below, keyed on the
  // same values so its closure is never stale.)
  useEffect(() => {
    pushThemeToFrame(iframeRef.current, monitorOrigin, colorTheme)
  }, [colorTheme, reloadNonce, monitorOrigin])
  const scale = monitorZoom / 100

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
    // #44: the theme rides along on every keyboard-reclaim path — a
    // suspended OOPIF drops messages, so each regain re-pushes the theme
    // (latest value wins, the page applies it idempotently). Keyed on the
    // theme/origin so the closure never goes stale.
    const reclaimIfLost = () => {
      const active = document.activeElement
      if (
        active === null ||
        active === document.body ||
        active instanceof HTMLIFrameElement
      ) {
        reclaimKeyboardFocus()
      }
      pushThemeToFrame(iframeRef.current, monitorOrigin, colorTheme)
    }
    const handleVisibility = () => {
      if (!document.hidden) reclaimIfLost()
    }
    window.addEventListener('focus', reclaimIfLost)
    document.addEventListener('visibilitychange', handleVisibility)
    // The Rust-side regain signal (NSWindowDidBecomeKey via lib.rs) —
    // WKWebView does not reliably surface DOM focus events for desktop
    // switches, the exact case the steal was reported on.
    const unlisten = listen('pnds:window-focus', reclaimIfLost)
    // Heartbeat backstop: every event path above can be dropped by the
    // suspended webview, but the interval itself was throttled with it —
    // the first tick after the webview resumes reclaims without needing
    // any event to arrive (user retest: the events alone proved inert).
    const heartbeat = setInterval(reclaimIfLost, 2000)
    return () => {
      window.removeEventListener('focus', reclaimIfLost)
      document.removeEventListener('visibilitychange', handleVisibility)
      clearInterval(heartbeat)
      void unlisten.then(off => off())
    }
  }, [monitorOrigin, colorTheme])

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
          ref={node => {
            iframeRef.current = node
          }}
          src={iframeSrc}
          title="Project monitor"
          className="block h-full w-full border-0"
          onLoad={() => {
            reclaimKeyboardFocus()
            pushThemeToFrame(iframeRef.current, monitorOrigin, colorTheme)
          }}
        />
      </div>

      {/* Top-center title / window drag region (§10.1). Themed via the
          monitor-bar tokens (v1.2.3 issue #38) — a scrim over the project
          page, so light themes keep the dark value. */}
      <div
        data-tauri-drag-region
        className="absolute left-1/2 top-0 z-40 -translate-x-1/2 cursor-default select-none rounded-b-xl bg-(--pnds-monitor-bar) px-5 py-1.5 text-xs font-medium tracking-wide text-(--pnds-monitor-bar-text) backdrop-blur-md"
      >
        PNDS - {displayOverride ?? projectName}
      </div>

      <HoverSidebar />
    </div>
  )
}
