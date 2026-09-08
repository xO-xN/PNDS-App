/**
 * v1.3.0 (#49): the monitor URL constructor — the single place the App
 * builds the address its monitor iframe navigates to. Carries the
 * first-frame parameters so following pages paint the correct
 * colors and language before any postMessage arrives (no light-then-dark
 * flash, no wrong-language flash):
 *
 * - `?theme=<name>` — the App ALWAYS sends it on load and reload (#49);
 * - `?lang=<code>` — same first-frame semantics, from the locale
 *   bridge (#54);
 * - `?_r=<n>` — the reload cache-buster: WKWebView keeps an on-disk
 *   NetworkCache keyed by the FULL URL (query included) that survives
 *   app restarts, so a project server sending no Cache-Control gets
 *   RFC 7234 heuristic freshness and a plain remount serves the stale
 *   entry offline. Sent ONLY on an explicit reload, changing with each
 *   one, so the refresh button is a true cold fetch.
 *
 * Contract: docs/zh-CN/reference/runtime-contract.md §11 (theme and
 * locale push). Pages must still tolerate all parameters being
 * absent, and must ignore unknown query parameters.
 */

/** First-frame URL parameters. Empty-string values are treated as absent. */
export interface MonitorUrlParams {
  /** Current color-theme name (e.g. "brutal"). */
  theme?: string
  /** Resolved language code (e.g. "zh-CN") pushed by the locale bridge. */
  lang?: string
  /** Reload nonce (0/absent = ordinary navigation; >0 = cache-busted). */
  reload?: number
}

export function buildMonitorUrl(
  host: string,
  port: number,
  params: MonitorUrlParams = {}
): string {
  const search = new URLSearchParams()
  if (params.theme) search.set('theme', params.theme)
  if (params.lang) search.set('lang', params.lang)
  // Falsy (0/undefined) reads as "no reload yet" — the first navigation
  // keeps the plain address and normal HTTP semantics.
  if (params.reload) search.set('_r', String(params.reload))
  const query = search.toString()
  return `http://${host}:${port}/${query ? `?${query}` : ''}`
}

/**
 * v1.4.0 (#62): the effective connection address for a project — the
 * manifest-declared `performerAddress` replaces the selected LAN IP,
 * mirroring what Rust injects as `PNDS_HOST_IP` (a blank declaration
 * reads as undeclared, same preflight tolerance). Used where the
 * address must be derived before a session snapshot exists (menu
 * address items); a live session reads the snapshot's `hostAddress`
 * instead — the backend is the injection authority.
 */
export function effectiveHostAddress(
  performerAddress: string | null | undefined,
  lanIp: string | null
): string | null {
  const declared = performerAddress?.trim()
  return (declared ? declared : null) ?? lanIp
}
