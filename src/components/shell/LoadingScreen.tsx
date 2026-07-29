import { useTranslation } from 'react-i18next'

/**
 * Loading placeholder (task-3). The real PNDS Logo p5 animation with the
 * five-stage contract (§10.3) replaces this in task-6.
 */
export function LoadingScreen() {
  const { t } = useTranslation()
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-4 bg-gradient-to-br from-[#eef2f8] via-[#e9edf6] to-[#e6ecf4]">
      <h1 className="text-4xl font-semibold tracking-wide">{t('app.name')}</h1>
      <p className="text-sm text-muted-foreground">{t('loading.starting')}</p>
    </div>
  )
}
