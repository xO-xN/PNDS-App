import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { stopAndReset } from '@/lib/open-project'
import { useSessionStore } from '@/store/session-store'
import {
  monitorNavigationRevealed,
  MONITOR_REVEAL_FADE_MS,
  MONITOR_REVEAL_FADE_TRANSITION,
} from '@/lib/monitor-reveal'
import { cn } from '@/lib/utils'
import { Button } from '@/components/ui/button'
import { PndsLogoCanvas } from './PndsLogoCanvas'

interface Props {
  onDissolveEnd?: () => void
}

/**
 * Loading screen (§10.3): just the PNDS Logo animation on a plain
 * background. Phase 1 plays autonomously; Phase 2 triggers when the
 * session reports ready. Cancel sits below as a subtle link.
 *
 * v1.3.0 (#50): the splash no longer ends with the logo closure. The
 * monitor iframe mounts beneath this layer as soon as the session is
 * ready, and the WHOLE splash (logo + background) cross-fades away
 * only when the reveal gate releases — the iframe's own load event,
 * or the timeout backstop. Between closure and release the final logo
 * frame simply holds, so no unloaded iframe ever flashes through.
 */
export function LoadingScreen({ onDissolveEnd }: Props) {
  const { t } = useTranslation()
  const health = useSessionStore(state => state.health)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const audioMode = useSessionStore(state => state.audioMode)
  const reallyReady = sessionStatus === 'ready' && health !== null
  const released = useSessionStore(state =>
    monitorNavigationRevealed(state.monitorLoaded, state.monitorLoadTimedOut)
  )

  // The logo closure is canvas-driven; once it completes the final
  // frame holds until the release condition above arrives.
  const [closureDone, setClosureDone] = useState(false)
  const dissolving = closureDone && released

  // Cross-fade out over the already-loaded monitor beneath; the parent
  // unmounts this layer (onDissolveEnd) exactly as the fade completes.
  useEffect(() => {
    if (!dissolving) return
    const id = setTimeout(() => onDissolveEnd?.(), MONITOR_REVEAL_FADE_MS)
    return () => clearTimeout(id)
  }, [dissolving, onDissolveEnd])

  // §10.3: internal sessions wait for scsynth/CoreAudio boot, so their
  // entrance phase runs 2s (120 frames at 60fps); external/none keep the
  // classic ~0.83s entrance.
  const entranceFrames = audioMode === 'internal' ? 120 : 50

  const handleCancel = async () => {
    await stopAndReset()
  }

  return (
    <div
      className={cn(
        'flex h-full w-full flex-col items-center justify-center bg-(--pnds-bg)',
        dissolving && 'opacity-0'
      )}
      style={{ transition: MONITOR_REVEAL_FADE_TRANSITION }}
    >
      <PndsLogoCanvas
        size={380}
        ready={reallyReady}
        onClosureEnd={() => setClosureDone(true)}
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
