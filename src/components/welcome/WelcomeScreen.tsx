import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/store/project-store'
import { isSessionBusy, useSessionStore } from '@/store/session-store'
import { promptOpenProject } from '@/lib/open-project'

/**
 * Welcome main area (§10.4; Figma "Starting Page"): hero text plus the
 * plain hint. v1.2.2 (issue #31): a central accent "Import Project" CTA
 * joins the subtitle — first-use visitors no longer need to know the
 * sidebar. Import now has three entries: this CTA, the list-tail "+" (T2)
 * and ⌘O, all funnelling through the same promptOpenProject. Projects
 * still start by clicking a sidebar entry — preflight runs directly
 * (v1.2.0 removed the trust gate, spec issue #15) and starting is
 * explicit via the Load button.
 */
export function WelcomeScreen() {
  const { t } = useTranslation()
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const preflightError = useProjectStore(state => state.preflightError)
  const sessionStatus = useSessionStore(state => state.sessionStatus)

  // Same busy gate as every import entry and the submit button — the
  // picker itself is a native modal that blocks interaction on its own.
  const busy = isSessionBusy(sessionStatus)

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

      {/* #31: the central import CTA — same visual language as the Load
          button (h-10 / rounded-xl / accent fill), standing alone so it
          carries its own radius and a subtle press-scale. */}
      <button
        type="button"
        data-testid="welcome-import-button"
        onClick={() => void promptOpenProject()}
        disabled={busy}
        className="mt-8 flex h-10 items-center justify-center rounded-xl bg-(--pnds-accent) px-6 text-[14px] text-white transition hover:bg-(--pnds-accent-hover) active:scale-[0.98] disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-(--pnds-accent) focus-visible:outline-offset-1"
      >
        {t('welcome.importProject')}
      </button>

      <p className="mt-10 max-w-2xl text-center text-[15px] leading-8 text-(--pnds-text)/80">
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
