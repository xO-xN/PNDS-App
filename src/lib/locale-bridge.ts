/**
 * v1.3.0 (#54): the locale bridge — pushes the App's resolved language
 * code into the project's monitor iframe over cross-origin `postMessage`.
 * Shares the theme bridge's (#44) delivery machinery and semantics: the
 * pushes ride the same triggers (iframe load, language switch, window
 * focus, heartbeat), delivery is one-way and best-effort with
 * latest-value-wins, and the whole channel is OPTIONAL for projects — a
 * page that never listens behaves exactly as before. See the runtime
 * contract §11 (locale push) for the contract.
 */

export const LOCALE_MESSAGE_TYPE = 'pnds:locale'
export const LOCALE_MESSAGE_VERSION = 1

/** The message shape App → monitor iframe (contract: runtime-contract.md §11). */
export interface LocaleMessage {
  type: typeof LOCALE_MESSAGE_TYPE
  version: number
  /** Resolved language code (e.g. "en" / "zh-CN") — never the setting. */
  locale: string
}

export function buildLocaleMessage(locale: string): LocaleMessage {
  return {
    type: LOCALE_MESSAGE_TYPE,
    version: LOCALE_MESSAGE_VERSION,
    locale,
  }
}

/**
 * Sends the resolved language into the monitor iframe. Same delivery
 * contract as `pushThemeToFrame`: best-effort, "latest value wins",
 * applied idempotently by the page, and never throwing — a bridge
 * failure must never affect the show.
 *
 * `targetOrigin` is the monitor's exact origin — never `*`.
 */
export function pushLocaleToFrame(
  frame: HTMLIFrameElement | null,
  targetOrigin: string,
  locale: string
): boolean {
  const contentWindow = frame?.contentWindow
  if (!contentWindow) return false
  try {
    contentWindow.postMessage(buildLocaleMessage(locale), targetOrigin)
    return true
  } catch {
    return false
  }
}
