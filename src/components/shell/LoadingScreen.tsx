import { useEffect, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { stopAndReset } from '@/lib/open-project'
import { useSessionStore } from '@/store/session-store'
import { Button } from '@/components/ui/button'
import { AnimatedPndsLogo } from './PndsLogo'

/**
 * Loading screen with the five-stage PNDS Logo animation (§10.3).
 *
 * Dots appear in real-time as the Rust session pushes `startupStage`:
 * 1 = preflight passed → 2 = audio ready → 3 = node started →
 * 4 = health ready → 5 = monitor loaded (frontend only). After stage 5
 * the logo spins and dissolves while the monitor fades in underneath.
 */
export function LoadingScreen() {
  const { t } = useTranslation()
  const startupStage = useSessionStore(state => state.startupStage)
  const health = useSessionStore(state => state.health)
  const completedRef = useRef(false)

  const phaseText = health
    ? t('loading.waitingReady')
    : t('loading.startingServer')

  // Mark stage 5 when the monitor iframe has loaded (task-3 already
  // waits for the iframe to render — we bump stage via a small delay
  // after health ready, covering the iframe paint).
  useEffect(() => {
    if (startupStage >= 4 && !completedRef.current) {
      // Give the monitor iframe a brief moment to render before
      // starting the dissolve animation.
      const timer = setTimeout(() => {
        useSessionStore.getState().setStartupStage(5)
        completedRef.current = true
      }, 600)
      return () => clearTimeout(timer)
    }
  }, [startupStage])

  const handleCancel = async () => {
    await stopAndReset()
  }

  return (
    <div className="flex min-h-full flex-col items-center bg-[#d9d9d9] p-8 pt-[24vh]">
      <h1 className="text-[28px] font-light tracking-wide text-black">
        {t('loading.title')}
      </h1>
      <div className="mt-[7vh]">
        <AnimatedPndsLogo stage={startupStage} size={190} />
      </div>
      <p className="mt-[6vh] text-[15px] text-black/60">{phaseText}</p>
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
