import { logger } from '@/lib/logger'
import { commands } from '@/lib/tauri-bindings'
import { useWebKitBaselineStore } from '@/store/webkit-baseline-store'

/** The Safari release whose system WebKit the frontend build actually
 * requires (v1.4.2 #110; spec #108): 16.4 is the frontend's real feature
 * baseline. The gate was load-bearing on v1.4.2's Intel lane, whose
 * macOS 12 floor allowed system WebKit as old as 15.1; since v1.4.3
 * (#116) every supported Mac runs macOS 13.5+ (system WebKit ≥ 16.4),
 * so the gate is a never-expected safety net, kept unchanged. */
export const SAFARI_BASELINE = '16.4'

/** Apple's "Update to the latest version of Safari" guide, localized to
 * the app language (both locale slugs verified live). The gate dialog's
 * primary action opens it. */
export function safariUpdateGuideUrl(language: string): string {
  const locale = language.toLowerCase().startsWith('zh') ? 'zh-cn' : 'en-us'
  return `https://support.apple.com/${locale}/102665`
}

export type WebKitBaselineVerdict = 'supported' | 'below-baseline' | 'unknown'

/**
 * Pure dotted-version comparison against SAFARI_BASELINE — the testable
 * seam of the gate. Inputs that don't parse as dotted numeric digits
 * (missing, mangled) are 'unknown': a failed probe must stay silent
 * rather than block a healthy machine.
 */
export function evaluateWebKitBaseline(
  safariVersion: string | null | undefined
): WebKitBaselineVerdict {
  if (!safariVersion) return 'unknown'
  const parts = safariVersion.split('.')
  if (parts.some(part => !/^\d+$/.test(part))) return 'unknown'
  const version = parts.map(Number)
  const baseline = SAFARI_BASELINE.split('.').map(Number)
  for (let i = 0; i < Math.max(version.length, baseline.length); i++) {
    const a = version[i] ?? 0
    const b = baseline[i] ?? 0
    if (a > b) return 'supported'
    if (a < b) return 'below-baseline'
  }
  return 'supported'
}

/**
 * The startup half of #110: ask the backend for the installed Safari
 * version and raise the App-styled dialog when it sits below the
 * baseline. The backend is the only source — WKWebView freezes
 * `navigator.userAgent` at AppleWebKit/605.1.15, so JS cannot learn the
 * engine version. Supported and unknown both stay silent; a below-baseline
 * verdict flags the store with the detected version for the details block.
 */
export async function runWebKitBaselineCheck(): Promise<void> {
  let version: string | null = null
  try {
    const result = await commands.systemSafariVersion()
    if (result.status === 'error') {
      logger.warn('Failed to read system Safari version', {
        error: result.error,
      })
    } else {
      version = result.data
    }
  } catch (error) {
    logger.warn('Failed to read system Safari version', { error })
  }
  const verdict = evaluateWebKitBaseline(version)
  logger.info(
    version === null
      ? `WebKit baseline check: ${verdict} (Safari version unknown)`
      : `WebKit baseline check: ${verdict} (Safari ${version})`
  )
  if (verdict === 'below-baseline' && version !== null) {
    useWebKitBaselineStore.getState().flagBelowBaseline(version)
  }
}
