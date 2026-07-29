import { open } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'

/**
 * Shared "open project" flow (§4, §5, §7): folder picker → trust gate →
 * preflight → session defaults. Used by the welcome screen and the sidebar.
 * The trust confirmation dialog is rendered by WelcomeScreen, driven by
 * `pendingTrustPath` in the project store.
 */
export async function promptOpenProject(): Promise<void> {
  const selected = await open({
    directory: true,
    multiple: false,
    title: i18n.t('welcome.openProject'),
  })
  if (!selected) return

  if (useProjectStore.getState().isTrusted(selected)) {
    void runPreflight(selected)
  } else {
    useProjectStore.getState().requestTrust(selected)
  }
}

/** Confirms trust for the pending path and runs preflight. */
export function confirmTrustAndOpen(): void {
  const path = useProjectStore.getState().pendingTrustPath
  if (!path) return
  useProjectStore.getState().trustProject(path)
  useProjectStore.getState().requestTrust(null)
  void runPreflight(path)
}

/** Runs preflight and, on success, seeds session defaults (§6.1, §7). */
export async function runPreflight(path: string): Promise<void> {
  useProjectStore.getState().startPreflight()
  useSessionStore.getState().resetSession()
  logger.info('Running project preflight', { path })
  const result = await commands.preflightProject(path)
  if (result.status === 'error') {
    useProjectStore.getState().preflightFailed(result.error)
    logger.warn('Preflight failed', { path, error: result.error })
    return
  }
  useProjectStore.getState().preflightSucceeded(path, result.data)
  logger.info('Preflight passed', { project: result.data.name })

  useSessionStore.getState().setAudioMode(result.data.audio.defaultMode)
  const addrs = await commands.listLanAddresses()
  if (addrs.status === 'ok') {
    useSessionStore.getState().setLanAddresses(addrs.data)
    const [first] = addrs.data
    if (addrs.data.length === 1 && first) {
      useSessionStore.getState().setLanIp(first)
    }
  }
}
