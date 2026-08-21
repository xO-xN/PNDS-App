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
  const audioMode = useSessionStore(state => state.audioMode)

  const reallyReady = sessionStatus === 'ready' && health !== null

  // §10.3: internal sessions wait for scsynth/CoreAudio boot, so their
  // entrance phase runs 2s (120 frames at 60fps); external/none keep the
  // classic ~0.83s entrance.
  const entranceFrames = audioMode === 'internal' ? 120 : 50

  const handleCancel = async () => {
    await stopAndReset()
  }

  return (
    // No bg wash: the AppShell branch root owns the base coat — a second
    // coat here is invisible in solid themes but doubles the white in
    // Glass (issue #41).
    <div className="flex h-full w-full flex-col items-center justify-center">
      <PndsLogoCanvas
        size={380}
        ready={reallyReady}
        onDissolveEnd={onDissolveEnd}
        entranceFrames={entranceFrames}
      />
      <Button
        variant="link"
        size="sm"
        className="mt-6 text-(--pnds-text)/40 hover:text-(--pnds-text)/60"
        onClick={() => void handleCancel()}
      >
        {t('loading.cancel')}
      </Button>
    </div>
  )
}
