/**
 * v1.3.0 (#49): the monitor URL constructor — the single place the App
 * builds the address its monitor iframe navigates to. Carries the
 * first-frame parameters so following pages paint the correct
 * colors and language before any postMessage arrives (no light-then-dark
 * flash, no wrong-language flash):
 *
 * - `?theme=<name>` — the App ALWAYS sends it on load and reload (#49);
 * - `?lang=<code>` — same first-frame semantics, from the locale
 *   bridge (#54).
 *
 * Contract: docs/zh-CN/reference/network.md "Theme Following" and
 * "Locale Following". Pages must still tolerate both parameters being
 * absent.
 */

/** First-frame URL parameters. Empty-string values are treated as absent. */
export interface MonitorUrlParams {
  /** Current color-theme name (e.g. "brutal"). */
  theme?: string
  /** Resolved language code (e.g. "zh-CN") pushed by the locale bridge. */
  lang?: string
}

export function buildMonitorUrl(
  lanIp: string,
  port: number,
  params: MonitorUrlParams = {}
): string {
  const search = new URLSearchParams()
  if (params.theme) search.set('theme', params.theme)
  if (params.lang) search.set('lang', params.lang)
  const query = search.toString()
  return `http://${lanIp}:${port}/${query ? `?${query}` : ''}`
}
