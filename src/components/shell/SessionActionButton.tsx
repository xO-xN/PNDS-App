import { useTranslation } from 'react-i18next'
import { stopAndReset } from '@/lib/open-project'
import { canStart, start, restart } from '@/lib/session-flow'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { cn } from '@/lib/utils'

/**
 * Sidebar session action (§8). Selecting a project only preflights it.
 *
 * Rendered as the full-bleed footer of the settings card: the rows above
 * are all deferred, and this is their submit. In Welcome/Loading it is the
 * accent-colored Load once preflight + LAN are in place (§6.1, §7). While
 * the session runs it is a red Close — unless the user has changed a
 * setting (mode / device / LAN / OSC target), which turns it into an amber
 * Change (§8.3) that applies the pending config with a full restart.
 */
export function SessionActionButton() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const audioMode = useSessionStore(state => state.audioMode)
  const lanIp = useSessionStore(state => state.lanIp)
  const oscTargetInput = useSessionStore(state => state.oscTargetInput)
  const pendingChanges = useSessionStore(state => state.pendingChanges)

  const running = sessionStatus === 'ready'
  const busy = sessionStatus === 'starting' || sessionStatus === 'stopping'
  const loadable = canStart({
    currentProject,
    preflightStatus,
    sessionStatus,
    lanIp,
    audioMode,
    oscTargetInput,
  })

  // Full-bleed footer: the card clips the bottom corners, so no radius
  // and no shadow here — the card owns both.
  const baseClass = 'h-10 w-full text-[14px] transition-colors'

  // Close (running, no pending change)
  if (running && !pendingChanges) {
    return (
      <button
        type="button"
        onClick={() => void stopAndReset()}
        className={cn(
          baseClass,
          'bg-(--pnds-danger) text-white hover:bg-(--pnds-danger-hover)'
        )}
      >
        {t('sidebar.closeProject')}
      </button>
    )
  }

  // Change (running, pending config changes — no preflight gate; restart
  // handles its own validation)
  if (running && pendingChanges) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void restart()}
        className={cn(
          baseClass,
          'bg-(--pnds-warning) text-(--pnds-text) hover:bg-(--pnds-warning-hover)'
        )}
      >
        {busy ? t('session.stopping') : t('sidebar.change')}
      </button>
    )
  }

  // Load (idle)
  const label =
    sessionStatus === 'starting'
      ? t('session.starting')
      : sessionStatus === 'stopping'
        ? t('session.stopping')
        : t('sidebar.loadProject')

  return (
    <button
      type="button"
      disabled={!loadable || busy}
      onClick={() => void start()}
      className={cn(
        baseClass,
        loadable
          ? 'bg-(--pnds-accent) text-white hover:bg-(--pnds-accent-hover)'
          : 'bg-(--pnds-text)/6 text-(--pnds-text)/30'
      )}
    >
      {label}
    </button>
  )
}
