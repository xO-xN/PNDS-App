import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/store/project-store'

/**
 * Welcome main area (§10.4; Figma "Starting Page"): hero text plus the
 * plain hint. Adding a project is the sidebar's "+" button (v1.1.2 moved
 * it into the Projects header); projects start by clicking a sidebar
 * entry — preflight runs directly (v1.2.0 removed the trust gate, spec
 * issue #15) and starting is explicit via the Load button.
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

      {/* Stable status slot, always one line tall: the column is
          vertically centered, so a conditionally appearing "Checking
          project…" would briefly re-center and shift every element above
          it on each sidebar switch (the starting page "shook"). */}
      <p
        data-testid="welcome-status-slot"
        className="mt-6 min-h-5 text-sm text-(--pnds-text)/60"
      >
        {preflightStatus === 'checking' ? t('welcome.checking') : ''}
      </p>

      {/* Bottom-docked preflight errors, out of the centered column: an
          appearing/disappearing alert (any height) must never re-center
          the content above — same rule as the status slot, which a
          fixed-height reserve cannot honor for a multi-line error. */}
      <div className="absolute inset-x-8 bottom-8 flex justify-center">
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
