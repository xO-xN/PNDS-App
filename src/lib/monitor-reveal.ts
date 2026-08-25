/**
 * v1.3.0 (#50): the loading→monitor reveal gate. The splash (and the
 * reload cover) may only dissolve once the CURRENT iframe navigation
 * reports readiness — session-ready alone must not flip the monitor
 * in, or an unloaded iframe flashes between the two layers. The
 * timeout backstop bounds the wait so the splash can never stick.
 *
 * Gate state lives in the session store (`monitorLoaded` /
 * `monitorLoadTimedOut`, reset per navigation and per run); this
 * module owns the release decision and the two timings every layer
 * (splash fade, reload cover fade, backstop) must share.
 */

/** How long a navigation may stay unrevealed before the backstop
 * releases the gate (and logs). Generous on purpose: local monitor
 * pages load in well under a second; this only catches true stalls. */
export const MONITOR_REVEAL_TIMEOUT_MS = 10_000

/** Cross-fade length shared by the splash dissolve and the reload
 * cover fade-out. Covers appear INSTANTLY (no fade-in — a fading-in
 * cover would itself flash the rebuilding iframe through). */
export const MONITOR_REVEAL_FADE_MS = 400

/** The composed CSS transition for the fade-out — shared so the splash
 * and the reload cover can never diverge on length or easing. */
export const MONITOR_REVEAL_FADE_TRANSITION = `opacity ${MONITOR_REVEAL_FADE_MS}ms ease-in`

/**
 * The release condition for one iframe navigation: revealed when its
 * iframe reported load, or when the timeout backstop fired. With both
 * inputs false (the session merely ready), the gate holds — that hold
 * is the whole point of #50.
 */
export function monitorNavigationRevealed(
  loaded: boolean,
  timedOut: boolean
): boolean {
  return loaded || timedOut
}
