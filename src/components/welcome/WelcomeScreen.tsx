import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { useProjectStore } from '@/store/project-store'
import { confirmTrustAndOpen, promptOpenProject } from '@/lib/open-project'
import { useSessionStore } from '@/store/session-store'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'

/**
 * Welcome main area (§10.4; Figma "Starting Page"): hero text plus the hint
 * with an inline "+ Open" pill. Projects start by clicking a sidebar entry
 * or opening a folder — after trust (§4) and preflight (§5), the
 * session starts automatically. Renders the trust confirmation dialog.
 */
export function WelcomeScreen() {
  const { t } = useTranslation()
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const preflightError = useProjectStore(state => state.preflightError)
  const pendingTrustPath = useProjectStore(state => state.pendingTrustPath)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const busy = preflightStatus === 'checking' || sessionStatus === 'starting'

  return (
    <div className="flex min-h-full flex-col items-center justify-center bg-[#d9d9d9] p-8 animate-[fade-in_0.5s_ease-in]">
      <header className="text-center">
        <h1 className="text-[44px] font-light leading-tight tracking-wide text-black">
          {t('welcome.title')}
        </h1>
        <p className="mt-3 text-[16px] text-black/60">
          {t('welcome.subtitle')}
        </p>
      </header>

      <p className="mt-[10vh] max-w-2xl text-center text-[15px] leading-8 text-black/80">
        {t('welcome.hintStart')}
        <button
          type="button"
          onClick={() => void promptOpenProject()}
          disabled={busy}
          aria-label={t('welcome.openProject')}
          className="mx-1 inline-flex h-6 translate-y-[-1px] items-center gap-1 rounded-full border border-black/60 px-3 align-baseline text-[12px] text-black hover:bg-black/5 disabled:opacity-50"
        >
          <Plus size={12} />
          {t('sidebar.open')}
        </button>
        {t('welcome.hintEnd')}
        <br />
        {t('welcome.hintSelect')}
      </p>

      {preflightStatus === 'checking' && (
        <p className="mt-6 text-sm text-black/60">{t('welcome.checking')}</p>
      )}

      {preflightStatus === 'error' && preflightError && (
        <div
          role="alert"
          className="font-manrope mt-6 max-w-xl whitespace-pre-wrap rounded-xl border border-red-800/20 bg-red-500/10 p-4 text-start text-sm text-red-900"
        >
          {preflightError}
        </div>
      )}

      <AlertDialog
        open={pendingTrustPath !== null}
        onOpenChange={openState => {
          if (!openState) useProjectStore.getState().requestTrust(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('trust.title')}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-wrap break-all">
              {t('trust.description', { path: pendingTrustPath })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('trust.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void confirmTrustAndOpen()}>
              {t('trust.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
