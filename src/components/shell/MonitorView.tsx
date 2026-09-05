import { useEffect, useMemo, useRef } from 'react'
import { listen } from '@tauri-apps/api/event'
import { useTranslation } from 'react-i18next'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import {
  useSettingsStore,
  currentColorThemeSetting,
} from '@/store/settings-store'
import { pushThemeToFrame } from '@/lib/theme-bridge'
import { pushLocaleToFrame } from '@/lib/locale-bridge'
import { buildMonitorUrl } from '@/lib/monitor-url'
import {
  BUILTIN_UTILITY_DISPLAY_NAMES,
  builtinUtilityId,
} from '@/lib/builtin-utilities'
import { currentResolvedLanguage } from '@/i18n/config'
import {
  monitorNavigationRevealed,
  MONITOR_REVEAL_TIMEOUT_MS,
  MONITOR_REVEAL_FADE_TRANSITION,
} from '@/lib/monitor-reveal'
import { cn } from '@/lib/utils'
import { HoverSidebar } from './HoverSidebar'

/** The payload shape of the injected reporter's pnds:guest-focus
 * messages (window.rs GUEST_FOCUS_SCRIPT) — anything else arriving on
 * `message` is not the reporter and must not move the gate. */
function isGuestFocusPayload(
  data: unknown
): data is { type: 'pnds:guest-focus'; interacting: boolean } {
  if (typeof data !== 'object' || data === null) return false
  const candidate = data as { type?: unknown; interacting?: unknown }
  return (
    candidate.type === 'pnds:guest-focus' &&
    typeof candidate.interacting === 'boolean'
  )
}

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
  // manifest name the session reports. v1.3.3 (#84): a built-in tool's
  // concise alias is the next stop — resolved above the learned names,
  // so the manifest name preflight learns on selection can't flip a
  // running tool's title back to the long name (same precedence order
  // as projectDisplayName).
  const displayOverride = useProjectStore(state =>
    sessionProjectPath
      ? (state.projectDisplayNames[sessionProjectPath] ??
        BUILTIN_UTILITY_DISPLAY_NAMES[builtinUtilityId(sessionProjectPath)] ??
        state.manifestProjectNames[sessionProjectPath])
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
  // v1.3.0 (#54): the locale bridge — same pattern as the theme bridge,
  // pushing the RESOLVED language code (never the 'system' setting, which
  // has no code to send). useTranslation re-renders on languageChanged,
  // so a switch re-runs the push effects below. The fallback chain
  // intentionally repeats currentResolvedLanguage()'s: this one reads the
  // hook's instance (subscription-reactive), while the URL memo below
  // must go through the accessor (a render-scope value here would become
  // a memo dependency and defrost the navigation snapshot).
  const { i18n } = useTranslation()
  const locale = i18n.resolvedLanguage ?? i18n.language ?? 'en'
  const iframeRef = useRef<HTMLIFrameElement | null>(null)
  const monitorPort = health?.scoreServer?.monitorPort
  const monitorOrigin = `http://${lanIp}:${monitorPort}`
  // v1.3.0 (#49/#54): `?theme=` and `?lang=` ride in the URL as
  // first-frame parameters, so following pages paint the right colors
  // and language before any postMessage arrives. The src is snapshotted
  // per iframe NAVIGATION — mount, address change, reload — which is
  // exactly the memo's dep list: a live theme or language switch must
  // NOT retarget the src (that would reload the live monitor page); the
  // bridges push the new values instead, and the next navigation
  // re-snapshots them. Both are therefore read from their live sources
  // inside the memo (latest values), never from the render-time
  // `colorTheme` / `locale` (which would defrost the snapshot).
  const iframeSrc = useMemo(() => {
    // The nonce only widens the memo: each bump remounts the iframe
    // (its React key), and the fresh load re-snapshots the theme. The
    // address fallbacks never reach the DOM — the guard below replaces
    // the whole view until a real address exists.
    void reloadNonce
    return buildMonitorUrl(lanIp ?? '', monitorPort ?? 0, {
      theme: currentColorThemeSetting(),
      lang: currentResolvedLanguage(),
    })
  }, [lanIp, monitorPort, reloadNonce])
  // v1.3.0 (#50): the reveal gate. Every navigation reports readiness
  // from its own load event; the backstop below bounds the wait. The
  // cover hides the still-loading iframe (visible on reloads, when no
  // splash sits above it) behind the App theme until the gate opens.
  const revealed = useSessionStore(state =>
    monitorNavigationRevealed(state.monitorLoaded, state.monitorLoadTimedOut)
  )
  useEffect(() => {
    if (revealed) return
    const id = setTimeout(() => {
      useSessionStore.getState().markMonitorTimedOut()
    }, MONITOR_REVEAL_TIMEOUT_MS)
    return () => clearTimeout(id)
  }, [reloadNonce, revealed])
  // Initial push + re-push on theme/language switch and monitor reload.
  // (The focus-regain re-push lives in the reclaim effect below, keyed on
  // the same values so its closure is never stale.)
  useEffect(() => {
    pushThemeToFrame(iframeRef.current, monitorOrigin, colorTheme)
    pushLocaleToFrame(iframeRef.current, monitorOrigin, locale)
  }, [colorTheme, locale, reloadNonce, monitorOrigin])
  const scale = monitorZoom / 100

  // WKWebView hands the keyboard first responder to a freshly loaded
  // out-of-process iframe when no element in the main frame holds focus.
  // The window-level shortcuts (⌘ layer, Esc) then go dead until the next
  // click — most visibly on the first project opened after launch, the
  // only session entered without a host element ever being focused.
  // Focusing the host root on mount and after every monitor load/reload
  // keeps the shell's keyboard layer alive. This never fights the page:
  // while the guest page holds focus on an interactive element, every
  // reclaim below stands down (the guest-focus gate).
  const reclaimKeyboardFocus = () => {
    window.focus()
    hostRef.current?.focus()
  }
  useEffect(() => {
    reclaimKeyboardFocus()
  }, [])
  // v1.3.5 (#105): the guest focus signal. The all-frames user script
  // (window.rs GUEST_FOCUS_SCRIPT) makes the monitor page report its
  // focus state: `interacting: true` while a page element (anything but
  // body/html) holds focus, `false` the moment focus falls back to the
  // page body or leaves the page. The page's keyboard is never stolen
  // mid-interaction (tnd/template inputs and dropdowns); when the page
  // is done with it, the keyboard comes back at once.
  const guestInteractingRef = useRef(false)
  // v1.2.2 (user report on #29): switching to another desktop and back can
  // hand the first responder to the monitor iframe again — every
  // window-level key (the ⌘ layer above all) then goes dead until the
  // next click. Reclaim on focus/visibility regain, but only when
  // nothing meaningful holds focus: never steal from a sidebar input or
  // an open dialog — and since v1.3.5 (#105) never from the guest page
  // the user is working in.
  useEffect(() => {
    // #44/#54: both bridges ride along on every keyboard-reclaim path —
    // a suspended OOPIF drops messages, so each regain re-pushes the
    // theme and the language (latest value wins, the page applies them
    // idempotently). Keyed on the values so the closure never goes
    // stale. The pushes are focus-neutral, so they run even while the
    // guest gate holds.
    const reclaimIfLost = () => {
      if (!guestInteractingRef.current) {
        const active = document.activeElement
        if (
          active === null ||
          active === document.body ||
          active instanceof HTMLIFrameElement
        ) {
          reclaimKeyboardFocus()
        }
      }
      pushThemeToFrame(iframeRef.current, monitorOrigin, colorTheme)
      pushLocaleToFrame(iframeRef.current, monitorOrigin, locale)
    }
    const handleGuestFocusMessage = (event: MessageEvent) => {
      // Only THIS iframe's reporter is trusted — anything else flying by
      // (another window, the page's own postMessage traffic) must not
      // move the gate.
      if (event.source !== iframeRef.current?.contentWindow) return
      if (!isGuestFocusPayload(event.data)) return
      guestInteractingRef.current = event.data.interacting
      // Focus back on the page body (or gone from the page): hand the
      // keyboard over immediately — activeElement is typically still the
      // iframe (the body inside it), the exact state reclaimIfLost
      // targets, and a meaningful main-frame holder is never stolen
      // from.
      if (!guestInteractingRef.current) reclaimIfLost()
    }
    const handleVisibility = () => {
      if (!document.hidden) reclaimIfLost()
    }
    window.addEventListener('focus', reclaimIfLost)
    window.addEventListener('message', handleGuestFocusMessage)
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
      window.removeEventListener('message', handleGuestFocusMessage)
      document.removeEventListener('visibilitychange', handleVisibility)
      clearInterval(heartbeat)
      void unlisten.then(off => off())
    }
  }, [monitorOrigin, colorTheme, locale])

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
            // A fresh document has not been interacted with — the guest
            // gate re-arms for the page that just loaded (its reporter
            // re-registers with it).
            guestInteractingRef.current = false
            reclaimKeyboardFocus()
            pushThemeToFrame(iframeRef.current, monitorOrigin, colorTheme)
            pushLocaleToFrame(iframeRef.current, monitorOrigin, locale)
            // #50: the load event IS the reveal signal — the splash (or
            // the reload cover) may now dissolve off this navigation.
            useSessionStore.getState().markMonitorLoaded()
          }}
        />
      </div>

      {/* #50: reveal cover — appears INSTANTLY over a rebuilding iframe
          (a fading-in cover would flash it through), fades out with the
          splash's cross-fade timing once the gate releases. Sits under
          the title strip (z-40) so the drag region never disappears.
          data-reveal-motion exempts the fade from Brutal's instant rule
          (theme-variables.css) — the cross-fade is the anti-flash
          contract, not a surface tint. */}
      <div
        aria-hidden
        data-testid="monitor-reveal-cover"
        data-reveal-motion=""
        className={cn(
          'absolute inset-0 z-30 bg-(--pnds-bg)',
          revealed && 'pointer-events-none opacity-0'
        )}
        style={
          revealed ? { transition: MONITOR_REVEAL_FADE_TRANSITION } : undefined
        }
      />

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
