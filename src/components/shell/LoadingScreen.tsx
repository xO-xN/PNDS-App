import { useTranslation } from 'react-i18next'
import { commands } from '@/lib/tauri-bindings'
import { useSessionStore } from '@/store/session-store'
import { Button } from '@/components/ui/button'

/**
 * Loading placeholder (task-3). The real PNDS Logo p5 animation with the
 * five-stage contract (§10.3) replaces this in task-6. A stuck startup can
 * always be cancelled (§10.3 Back/Close semantics), which stops the score
 * server and returns to Welcome.
 */
export function LoadingScreen() {
  const { t } = useTranslation()

  const handleCancel = async () => {
    await commands.stopProject()
    useSessionStore.getState().resetSession()
  }

  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#eef2f8] via-[#e9edf6] to-[#e6ecf4]">
      <h1 className="text-4xl font-semibold tracking-wide">{t('app.name')}</h1>
      <p className="text-sm text-muted-foreground">{t('loading.starting')}</p>
      <Button variant="outline" size="sm" onClick={() => void handleCancel()}>
        {t('loading.cancel')}
      </Button>
    </div>
  )
}
