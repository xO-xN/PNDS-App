/**
 * The guest-focus gate (v1.3.5 #105/#107), extracted from MonitorView:
 * WKWebView hands the keyboard first responder to the out-of-process
 * monitor iframe whenever no main-frame element holds focus, killing
 * every window-level shortcut until the next click. The gate decides
 * when the shell may take the keyboard back — and, just as important,
 * when it may not:
 *
 * - the guest gate (#105): the all-frames reporter script
 *   (window.rs `GUEST_FOCUS_SCRIPT`) makes the monitor page report its
 *   focus state — `interacting: true` while a page element (anything
 *   but body/html) holds focus. The page's keyboard is never stolen
 *   mid-interaction (tnd/template inputs and dropdowns).
 * - the pointer-area gate (#107): homemade page controls (div menus
 *   with no tabindex) never fire focusin, so the guest gate alone can
 *   miss them — but the pointer sitting inside the monitor frame means
 *   the user is working in the page. A ≤500ms leave debounce absorbs
 *   boundary jitter, and every reclaim re-verifies with
 *   elementFromPoint at the last known coordinates so a missed leave
 *   cannot strand the gate.
 *
 * The host keeps what a reclaim MEANS (focusing its keyboard surface,
 * re-pushing the theme/locale bridges) and supplies it through the two
 * callbacks; the gate owns all listening, timing and state.
 */
import { useEffect, useRef } from 'react'
import { onWindowFocus } from '@/lib/events'

/**
 * The guest-focus wire contract: the message type the injected reporter
 * posts and this gate listens for. The Rust twin is
 * `GUEST_FOCUS_MESSAGE_TYPE` in src-tauri/src/window.rs (the reporter
 * script is built from it) — Rust cannot import TypeScript, so both
 * sides pin the same literal; window.rs's
 * `guest_focus_script_is_built_from_the_message_type_const` test guards
 * the pairing on that side.
 */
export const GUEST_FOCUS_MESSAGE_TYPE = 'pnds:guest-focus'

/** The reporter's payload shape, exactly as the script posts it. */
export interface GuestFocusPayload {
  type: typeof GUEST_FOCUS_MESSAGE_TYPE
  interacting: boolean
}

/**
 * True when `data` is the reporter's payload — anything else arriving on
 * `message` is not the reporter and must not move the gate.
 */
export function isGuestFocusPayload(data: unknown): data is GuestFocusPayload {
  if (typeof data !== 'object' || data === null) return false
  const candidate = data as { type?: unknown; interacting?: unknown }
  return (
    candidate.type === GUEST_FOCUS_MESSAGE_TYPE &&
    typeof candidate.interacting === 'boolean'
  )
}

/** #107: how long a frame-area leave holds before the gate re-arms —
 * boundary jitter (the title strip overlays the frame's top edge) must
 * not flicker the gate. */
const FRAME_POINTER_LEAVE_DEBOUNCE_MS = 500

/** The heartbeat backstop's cadence (see the effect below). */
const RECLAIM_HEARTBEAT_MS = 2000

/** What the gate needs from its host. */
export interface GuestFocusGateConfig {
  /** The monitor iframe — its contentWindow is the only trusted reporter
   * (the message handler validates the source), and the pointer gate's
   * hit test targets the frame element. Must be a stable ref (useRef). */
  frame: React.RefObject<HTMLIFrameElement | null>
  /** The keyboard-reclaim point: invoked exactly where MonitorView
   * reclaimed before the extraction — both gates open (guest idle,
   * pointer outside the frame area) AND focus stranded on the body,
   * nothing, or an iframe. Never while a gate holds, and never while a
   * meaningful main-frame holder (sidebar input, open dialog) has
   * focus. */
  onReclaim: () => void
  /** Every regain moment — window focus, visibility return, the
   * Rust-side key signal, a settled guest-focus `false`, the leave
   * debounce lifting, and each heartbeat tick — gates and focus state
   * notwithstanding. The theme/locale bridges ride here
   * (#44/#54): the pushes are focus-neutral, and a suspended OOPIF
   * drops messages, so each regain re-pushes. */
  onRegain: () => void
}

/** The surface the host binds to its iframe. */
export interface GuestFocusGate {
  /** Bind to the iframe's onMouseEnter — main-frame boundary event: the
   * pointer's moves INSIDE the frame never cross the origin boundary,
   * so only enter/leave mark the area. */
  onFramePointerEnter: (event: React.MouseEvent<HTMLIFrameElement>) => void
  /** Bind to the iframe's onMouseLeave — arms the debounce that lifts
   * the pointer gate. */
  onFramePointerLeave: () => void
  /** Call from the iframe's onLoad: a fresh document has not been
   * interacted with — the guest gate re-arms for the page that just
   * loaded (its reporter re-registers with it). */
  rearm: () => void
}

/**
 * The gate machine. All listeners register once; the callbacks arrive
 * through a ref (useCardDrag's pattern), so the host may rebuild them
 * per render with fresh bridge values without the listener set — or an
 * in-flight leave debounce, or the heartbeat phase — ever resetting.
 */
export function useGuestFocusGate(
  config: GuestFocusGateConfig
): GuestFocusGate {
  const configRef = useRef(config)
  useEffect(() => {
    configRef.current = config
  })
  const { frame } = config

  // #105: the guest focus signal — true while the monitor page's own
  // element holds focus.
  const guestInteractingRef = useRef(false)
  // #107: the pointer-area vote and its machinery.
  const pointerInsideFrameRef = useRef(false)
  const pointerPositionRef = useRef({ x: 0, y: 0 })
  const frameLeaveTimerRef = useRef<number | null>(null)
  // The leave debounce needs to run a reclaim check the moment it lifts
  // the gate; the effect below keeps the current closure here.
  const reclaimNowRef = useRef<() => void>(() => undefined)

  const rememberPointer = (x: number, y: number) => {
    pointerPositionRef.current = { x, y }
  }
  const cancelFrameLeave = () => {
    if (frameLeaveTimerRef.current !== null) {
      clearTimeout(frameLeaveTimerRef.current)
      frameLeaveTimerRef.current = null
    }
  }
  const onFramePointerEnter = (event: React.MouseEvent<HTMLIFrameElement>) => {
    cancelFrameLeave()
    pointerInsideFrameRef.current = true
    rememberPointer(event.clientX, event.clientY)
  }
  const onFramePointerLeave = () => {
    cancelFrameLeave()
    frameLeaveTimerRef.current = window.setTimeout(() => {
      frameLeaveTimerRef.current = null
      pointerInsideFrameRef.current = false
      // The gate lifted: if focus sits stranded in the frame, take it
      // back now instead of waiting for the next heartbeat.
      reclaimNowRef.current()
    }, FRAME_POINTER_LEAVE_DEBOUNCE_MS)
  }

  // v1.2.2 (user report on #29): switching to another desktop and back can
  // hand the first responder to the monitor iframe again — every
  // window-level key (the ⌘ layer above all) then goes dead until the next
  // click. Reclaim on focus/visibility regain, but only when
  // nothing meaningful holds focus: never steal from a sidebar input or
  // an open dialog — and since v1.3.5 (#105) never from the guest page
  // the user is working in.
  useEffect(() => {
    // #107: the pointer gate's vote — true while the enter flag holds.
    // With a leave settling, the debounce window owns the verdict (the
    // re-check below would cut it short over boundary jitter: the
    // pointer grazing chrome already refreshed the coordinates). With no
    // leave pending, the hit test at the last known coordinates guards
    // against a MISSED leave stranding the gate — chrome overlays above
    // the frame (the title strip, the hover sidebar) answer with
    // themselves, correctly un-gating.
    const pointerInFrameArea = () => {
      if (!pointerInsideFrameRef.current) return false
      if (frameLeaveTimerRef.current !== null) return true
      const { x, y } = pointerPositionRef.current
      return document.elementFromPoint(x, y) === frame.current
    }
    const reclaimIfLost = () => {
      if (!guestInteractingRef.current && !pointerInFrameArea()) {
        const active = document.activeElement
        if (
          active === null ||
          active === document.body ||
          active instanceof HTMLIFrameElement
        ) {
          configRef.current.onReclaim()
        }
      }
      configRef.current.onRegain()
    }
    reclaimNowRef.current = reclaimIfLost
    // The pointer's coordinates only ever arrive from main-frame surfaces
    // (chrome moves, the frame's enter event) — the freshest possible
    // position for the hit test above.
    const handlePointerMove = (event: MouseEvent) => {
      rememberPointer(event.clientX, event.clientY)
    }
    const handleGuestFocusMessage = (event: MessageEvent) => {
      // Only THIS iframe's reporter is trusted — anything else flying by
      // (another window, the page's own postMessage traffic) must not
      // move the gate.
      if (event.source !== frame.current?.contentWindow) return
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
    window.addEventListener('mousemove', handlePointerMove)
    window.addEventListener('message', handleGuestFocusMessage)
    document.addEventListener('visibilitychange', handleVisibility)
    // The Rust-side regain signal (NSWindowDidBecomeKey via lib.rs) —
    // WKWebView does not reliably surface DOM focus events for desktop
    // switches, the exact case the steal was reported on.
    const offWindowFocus = onWindowFocus(reclaimIfLost)
    // Heartbeat backstop: every event path above can be dropped by the
    // suspended webview, but the interval itself was throttled with it —
    // the first tick after the webview resumes reclaims without needing
    // any event to arrive (user retest: the events alone proved inert).
    const heartbeat = setInterval(reclaimIfLost, RECLAIM_HEARTBEAT_MS)
    return () => {
      window.removeEventListener('focus', reclaimIfLost)
      window.removeEventListener('mousemove', handlePointerMove)
      window.removeEventListener('message', handleGuestFocusMessage)
      document.removeEventListener('visibilitychange', handleVisibility)
      clearInterval(heartbeat)
      cancelFrameLeave()
      offWindowFocus()
    }
  }, [frame])

  return {
    onFramePointerEnter,
    onFramePointerLeave,
    rearm: () => {
      guestInteractingRef.current = false
    },
  }
}
