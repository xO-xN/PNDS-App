import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/store/project-store'

/**
 * Welcome main area (§10.4; Figma "Starting Page"): hero text plus the
 * plain hint — copy only, no interactive controls. Importing lives in the
 * project column's tail entry and ⌘O (both funnel through
 * promptOpenProject; a central CTA was tried in #31 and removed again
 * before release — the hint copy carries the first-use story). Projects
 * start by clicking a sidebar entry — preflight runs directly (v1.2.0
 * removed the trust gate, spec issue #15) and starting is explicit via
 * the Load button.
 */
export function WelcomeScreen() {
  const { t } = useTranslation()
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const preflightError = useProjectStore(state => state.preflightError)

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-(--pnds-bg) p-8 animate-[fade-in_0.8s_ease-in]">
      <header className="text-center">
        <h1 className="text-[44px] font-light leading-tight tracking-wide text-(--pnds-text)">
          {t('welcome.title')}
        </h1>
        <p className="mt-3 text-[16px] text-(--pnds-text)/60">
          {t('welcome.subtitle')}
        </p>
      </header>

      <p className="mt-[10vh] max-w-2xl text-center text-[15px] leading-8 text-(--pnds-text)/80">
        <span className="block">{t('welcome.hintAdd')}</span>
        <span className="block">{t('welcome.hintSelect')}</span>
      </p>

      <p className="mt-6 text-sm text-(--pnds-text)/80 select-none">
        {t('welcome.cmdHint')}
      </p>

      {/* Bottom-docked status, out of the centered column: an appearing
          or disappearing box (any height) must never re-center the content
          above. The transient "Checking project…" state uses the same
          docked rounded box as preflight errors, in the neutral gray
          variant; only one of the two can show at a time. */}
      <div className="absolute inset-x-8 bottom-8 flex justify-center">
        {preflightStatus === 'checking' && (
          <div
            data-testid="welcome-checking"
            className="font-manrope max-w-xl rounded-xl border border-(--pnds-text)/10 bg-(--pnds-pill) p-4 text-sm text-(--pnds-text)/60"
          >
            {t('welcome.checking')}
          </div>
        )}
        {preflightStatus === 'error' && preflightError && (
          <div
            role="alert"
            className="font-manrope max-w-xl whitespace-pre-wrap rounded-xl border border-red-800/20 bg-red-500/10 p-4 text-start text-sm text-red-900"
          >
            {preflightError}
          </div>
        )}
      </div>
    </div>
  )
}
