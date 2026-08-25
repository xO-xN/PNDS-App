/**
 * v1.3.0 (#49): the monitor URL constructor — the single place the App
 * builds the address its monitor iframe navigates to. Carries the
 * first-frame parameters so following pages can paint the correct
 * colors before any postMessage arrives (no light-then-dark flash):
 *
 * - `?theme=<name>` — the App ALWAYS sends it on load and reload;
 * - `?lang=<code>` — slot reserved for the locale bridge (v1.3.0 T2).
 *
 * Contract: docs/reference/network.md "Theme Following". Pages must
 * still tolerate both parameters being absent.
 */

/** First-frame URL parameters. Empty-string values are treated as absent. */
export interface MonitorUrlParams {
  /** Current color-theme name (e.g. "brutal"). */
  theme?: string
  /** Reserved for the locale bridge: parsed language code (e.g. "zh-CN"). */
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
