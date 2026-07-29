import { useTranslation } from 'react-i18next'
import { stopAndReset } from '@/lib/open-project'
import { canStart, start } from '@/lib/session-flow'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { cn } from '@/lib/utils'

/**
 * The sidebar's primary session action (§8). Selecting a project only
 * preflights it — starting is always explicit: Load turns green once the
 * project is preflighted, a LAN address is chosen (§7), and — for external
 * mode — the OSC target is valid (§6.6). Close while the session runs.
 *
 * Every field canStart reads is passed as an explicit argument so the
 * React Compiler can see that the hook results are consumed — without
 * this, unused hook subscriptions get dead-code-eliminated and the
 * component never re-renders after its initial mount.
 */
export function SessionActionButton() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const audioMode = useSessionStore(state => state.audioMode)
  const lanIp = useSessionStore(state => state.lanIp)
  const oscTargetInput = useSessionStore(state => state.oscTargetInput)

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
