import { useTranslation } from 'react-i18next'
import { stopAndReset } from '@/lib/open-project'
import { useSessionStore } from '@/store/session-store'
import { Button } from '@/components/ui/button'
import { PndsLogo } from './PndsLogo'

/**
 * Loading screen (§10.3; Figma "Loading a project"): title, the PNDS logo,
 * and the current phase text. task-3 placeholder — task-6 replaces the
 * static logo with the animated p5 sketch driven by the five real startup
 * stages, random colors, and the dissolve transition. Cancel stays as an
 * escape hatch for stuck startups (stops the score server, back to Welcome).
 */
export function LoadingScreen() {
  const { t } = useTranslation()
  const health = useSessionStore(state => state.health)

  const phaseText = health
    ? t('loading.waitingReady')
    : t('loading.startingServer')

  const handleCancel = async () => {
    await stopAndReset()
  }

  return (
    <div className="flex min-h-full flex-col items-center bg-[#d9d9d9] p-8 pt-[24vh]">
      <h1 className="text-[28px] font-light tracking-wide text-black">
        {t('loading.title')}
      </h1>
      <div className="mt-[7vh]">
        <PndsLogo size={190} />
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
