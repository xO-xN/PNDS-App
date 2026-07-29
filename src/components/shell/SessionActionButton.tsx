import { useTranslation } from 'react-i18next'
import { stopAndReset } from '@/lib/open-project'
import { canStart, start, restart } from '@/lib/session-flow'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { cn } from '@/lib/utils'

/**
 * Sidebar session action (§8). Selecting a project only preflights it.
 *
 * In Welcome/Loading the button is a green Load once preflight + LAN are
 * in place (§6.1, §7). While the session runs it is a red Close — unless
 * the user has changed a setting (mode / device / LAN / OSC target),
 * which turns it into a yellow Change (§8.3). The Change button applies
 * the pending configuration with a full session restart.
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

  // Close (running, no pending change)
  if (running && !pendingChanges) {
    return (
      <button
        type="button"
        onClick={() => void stopAndReset()}
        className="mt-3 h-9 w-full rounded-xl bg-[#ff3b30] text-[14px] text-white shadow-sm transition-colors hover:bg-[#ee2b20]"
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
        className="mt-3 h-9 w-full rounded-xl bg-[#f59e0b] text-[14px] text-white shadow-sm transition-colors hover:bg-[#d97706]"
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
        'mt-3 h-9 w-full rounded-xl text-[14px] shadow-sm transition-colors',
        loadable
          ? 'bg-[#34c759] text-white hover:bg-[#2eb34e]'
          : 'bg-black/10 text-black/40 shadow-none'
      )}
    >
      {label}
    </button>
  )
}
