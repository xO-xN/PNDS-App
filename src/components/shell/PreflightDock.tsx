import type { ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/store/project-store'

/**
 * The main area's bottom-docked feedback column (v1.5.0, #125 — grown out
 * of the starting page's dock, #124): the preflight「Checking project…」
 * and readable-error boxes every main-area panel (starting page, folder
 * README, project README) shares, plus optional per-panel residents the
 * host stacks ABOVE the boxes (the starting page's update notice, #121).
 * The host panel's root must be `relative` — the dock anchors to it, so
 * it travels with the panel's own height exactly as it did on the
 * starting page. The checking and error states are mutually exclusive by
 * construction (a check clears the last error on start).
 */
export function PreflightDock({ children }: { children?: ReactNode }) {
  const { t } = useTranslation()
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const preflightError = useProjectStore(state => state.preflightError)

  return (
    <div className="absolute inset-x-8 bottom-8 flex flex-col items-center gap-2">
      {children}
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
  )
}
