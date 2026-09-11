import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/store/project-store'
import { useUpdaterStore } from '@/store/updater-store'
import { openReleasesPage } from '@/lib/updater'
import { Button } from '@/components/ui/button'
import pndsIcon from '@/assets/pnds-icon.png'

/**
 * Welcome main area (§10.4; Figma "Starting Page"): hero text plus the
 * plain first-use tips — copy only, no interactive controls. Importing
 * lives in the project column's tail entry and ⌘O (both funnel through
 * promptOpenProject; a central CTA was tried in #31 and removed again
 * before release — the tip copy carries the first-use story). #69 made
 * the opening line "open a project from the left sidebar" and dropped
 * the add-project suggestion: opening an existing project is the
 * performer's main path. Projects start by clicking a sidebar entry —
 * preflight runs directly (v1.2.0 removed the trust gate, spec issue
 * #15) and starting is explicit via the Load button. The one standing
 * exception is the docked update notice (#121) — see the bottom dock.
 */
export function WelcomeScreen() {
  const { t } = useTranslation()
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const preflightError = useProjectStore(state => state.preflightError)
  const updateVersion = useUpdaterStore(state => state.available)

  return (
    <div className="relative flex min-h-full flex-col items-center justify-center bg-(--pnds-bg) p-8 animate-[fade-in_0.8s_ease-in]">
      {/* v1.3.3 (#86, ported from the site's welcome page): the app icon
          on a rippling halo stage — three rings phased a third of a cycle
          apart (negative delays, so a wave is already travelling at first
          paint) while the whole stage floats. The rings and halo take
          --pnds-accent so every theme owns its ripple; the icon keeps its
          own art, like a macOS icon in dark mode. Purely decorative.
          #122: the rings carry data-welcome-ring — the reduce-motion rule
          (App.css) hides them outright, because the instant-play cap parks
          them at their base style (a full-size static ring), not at the
          keyframes' opacity-0 end. */}
      <div
        data-testid="welcome-logo-stage"
        /* data-welcome-logo has two consumers: Brutal hides the whole
           stage on it (theme-variables.css — soft glow has no place on
           its hard plane), and App.css scopes the icon's no-drag rule
           to [data-welcome-logo] img (#122). */
        data-welcome-logo=""
        aria-hidden="true"
        className="relative mb-3 flex size-[172px] animate-[welcome-float_5.5s_ease-in-out_infinite_alternate] items-center justify-center rounded-full"
        style={{
          background:
            'radial-gradient(closest-side, color-mix(in oklab, var(--pnds-accent) 13%, transparent), transparent 72%)',
        }}
      >
        {/* The phase delays stay literal strings — Tailwind only
            generates arbitrary classes it can scan, so the map must
            not compose them at runtime. */}
        {['', '[animation-delay:-1.4s]', '[animation-delay:-2.8s]'].map(
          delayClass => (
            <span
              key={delayClass}
              data-welcome-ring=""
              className={`absolute inset-0 rounded-full border-[1.5px] border-(--pnds-accent)/40 animate-[welcome-logo-ripple_4.2s_cubic-bezier(0.2,0.55,0.35,1)_infinite] ${delayClass}`}
            />
          )
        )}
        <img
          src={pndsIcon}
          alt=""
          width={84}
          height={84}
          /* #122: the icon is decor, not data — dragging it out of the
             app must not save a bare image file. Attribute half; the
             WebKit enforcement half (-webkit-user-drag) lives in
             App.css. */
          draggable={false}
          className="relative z-[1] size-[84px] rounded-[18px] shadow-[0_10px_30px_rgba(16,24,40,0.16),0_2px_6px_rgba(16,24,40,0.08)]"
        />
      </div>
      <header className="text-center">
        <h1 className="text-[44px] font-light leading-tight tracking-wide text-(--pnds-text)">
          {t('welcome.title')}
        </h1>
        <p className="mt-3 text-[16px] text-(--pnds-text)/60">
          {t('welcome.subtitle')}
        </p>
      </header>

      <p className="mt-[10vh] max-w-2xl text-center text-[15px] leading-8 text-(--pnds-text)/80">
        <span className="block">{t('welcome.hintOpenProject')}</span>
      </p>

      {/* ⌘ is a keyboard affordance — select-none; the Help tip is
          documentation copy and stays selectable. */}
      <p className="mt-6 text-sm text-(--pnds-text)/80 select-none">
        <span className="block">{t('welcome.cmdHint')}</span>
      </p>
      <p className="mt-2 text-sm text-(--pnds-text)/80">
        <span className="block">{t('welcome.hintHelp')}</span>
      </p>

      {/* Bottom-docked status, out of the centered column: an appearing
          or disappearing box (any height) must never re-center the content
          above. The transient "Checking project…" state uses the same
          docked rounded box as preflight errors, in the neutral gray
          variant; only one of the two can show at a time. The update
          notice (#121) is the one persistent resident — a check (boot or
          manual) that found a version leaves it here for the rest of the
          session, so an update noticed mid-performance is still on the
          wall when the operator is back at the starting page; its button
          opens the Releases page (check-only — the app never installs). */}
      <div className="absolute inset-x-8 bottom-8 flex flex-col items-center gap-2">
        {updateVersion && (
          <div
            data-testid="welcome-update-notice"
            className="font-manrope flex items-center gap-3 rounded-xl border border-(--pnds-accent)/30 bg-(--pnds-pill) px-4 py-2.5 text-sm text-(--pnds-text)/70"
          >
            <span>{t('updater.noticeLine', { version: updateVersion })}</span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => void openReleasesPage()}
            >
              {t('updater.releasesAction')}
            </Button>
          </div>
        )}
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
            className="font-manrope max-w-xl whitespace-pre-wrap rounded-xl border border-(--pnds-danger)/20 bg-(--pnds-danger)/10 p-4 text-start text-sm text-(--pnds-text)"
          >
            {preflightError}
          </div>
        )}
      </div>
    </div>
  )
}
