import { useTranslation } from 'react-i18next'
import { stopAndReset } from '@/lib/open-project'
import { useSessionStore } from '@/store/session-store'
import { Button } from '@/components/ui/button'
import { PndsLogoCanvas } from './PndsLogoCanvas'

interface Props {
  onDissolveEnd?: () => void
}

/**
 * Loading screen (§10.3): just the PNDS Logo animation on a plain
 * background. Phase 1 plays autonomously; Phase 2 triggers when the
 * session reports ready. Cancel sits below as a subtle link.
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
    <div className="flex h-full w-full flex-col items-center justify-center bg-[#d9d9d9]">
      <PndsLogoCanvas
        size={380}
        ready={reallyReady}
        onDissolveEnd={onDissolveEnd}
      />
      <Button
        variant="link"
        size="sm"
        className="mt-6 text-black/40 hover:text-black/60"
        onClick={() => void handleCancel()}
      >
        {t('loading.cancel')}
      </Button>
    </div>
  )
}
