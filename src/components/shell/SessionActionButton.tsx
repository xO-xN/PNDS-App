import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { startIfReady, stopAndReset } from '@/lib/open-project'
import { cn } from '@/lib/utils'

/**
 * The sidebar's primary session action (§8). Selecting a project only
 * preflights it — starting is always explicit: Load turns green once the
 * project is preflighted and a LAN address is chosen (§7), and becomes a
 * red Close while the session runs.
 */
export function SessionActionButton() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const lanIp = useSessionStore(state => state.lanIp)

  const running = sessionStatus === 'ready'
  const busy = sessionStatus === 'starting' || sessionStatus === 'stopping'
  const canLoad =
    currentProject !== null && sessionStatus === 'idle' && lanIp !== null

  if (running) {
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

  return (
    <button
      type="button"
      disabled={!canLoad || busy}
      onClick={() => void startIfReady()}
      className={cn(
        'mt-3 h-9 w-full rounded-xl text-[14px] shadow-sm transition-colors',
        canLoad
          ? 'bg-[#34c759] text-white hover:bg-[#2eb34e]'
          : 'bg-black/10 text-black/40 shadow-none'
      )}
    >
      {busy ? t('session.stopping') : t('sidebar.loadProject')}
    </button>
  )
}
