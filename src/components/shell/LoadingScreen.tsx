import { useTranslation } from 'react-i18next'
import { stopAndReset } from '@/lib/open-project'
import { useSessionStore } from '@/store/session-store'
import { Button } from '@/components/ui/button'
import { PndsLogoCanvas } from './PndsLogoCanvas'

interface Props {
  onDissolveEnd?: () => void
}

/**
 * Loading screen with the PNDS Logo animation (§10.3 two-phase contract).
 *
 * Phase 1: autonomous dot/circle entrance (~0.8 s). Phase 2: triggered
 * when the session is ready — the logo converges and dissolves. The
 * `onDissolveEnd` callback lets AppShell route to the monitor afterward.
 */
export function LoadingScreen({ onDissolveEnd }: Props) {
  const { t } = useTranslation()
  const health = useSessionStore(state => state.health)
  const sessionStatus = useSessionStore(state => state.sessionStatus)

  const reallyReady = sessionStatus === 'ready' && health !== null

  const handleCancel = async () => {
    await stopAndReset()
  }

  return (
    <div className="flex min-h-full flex-col items-center bg-[#d9d9d9] p-8 pt-[24vh]">
      <h1 className="text-[28px] font-light tracking-wide text-black">
        {t('loading.title')}
      </h1>
      <div className="mt-[7vh]">
        <PndsLogoCanvas
          size={190}
          ready={reallyReady}
          onDissolveEnd={onDissolveEnd}
        />
      </div>
      <p className="mt-[6vh] text-[15px] text-black/60">
        {health ? t('loading.waitingReady') : t('loading.startingServer')}
      </p>
      <Button
        variant="outline"
        size="sm"
        className="mt-4 border-black/20 bg-transparent text-black/70 hover:bg-black/5"
        onClick={() => void handleCancel()}
      >
        {t('loading.cancel')}
      </Button>
    </div>
  )
}
