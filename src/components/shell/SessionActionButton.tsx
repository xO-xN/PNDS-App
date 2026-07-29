import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { startIfReady, stopAndReset } from '@/lib/open-project'
import { cn } from '@/lib/utils'

/**
 * The sidebar's primary session action (§8): Load starts the selected
 * project (once preflight passed and a LAN address is chosen, §7); Close
 * stops it. Sits below the settings card.
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

  if (running || busy) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void stopAndReset()}
        className={cn(
          'mt-3 h-9 w-full rounded-xl text-[14px] transition-colors',
          'border border-black/10 bg-[#f5f5f5] text-black shadow-sm hover:bg-white',
          'disabled:opacity-50'
        )}
      >
        {busy ? t('session.stopping') : t('sidebar.closeProject')}
      </button>
    )
  }

  return (
    <button
      type="button"
      disabled={!canLoad}
      onClick={() => void startIfReady()}
      className={cn(
        'mt-3 h-9 w-full rounded-xl text-[14px] transition-colors',
        'bg-[#0088ff] text-white shadow-sm hover:bg-[#0077ee]',
        'disabled:bg-black/10 disabled:text-black/40 disabled:shadow-none'
      )}
    >
      {t('sidebar.loadProject')}
    </button>
  )
}
