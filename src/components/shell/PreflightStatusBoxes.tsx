import { useTranslation } from 'react-i18next'
import { useProjectStore } from '@/store/project-store'

/**
 * The main area's docked preflight feedback — the transient "Checking
 * project…" box and the readable error box. Extracted from the starting
 * page (v1.5.0, #124) so every main-area panel (starting page, folder
 * README) docks the same feedback; each host positions it in its own
 * bottom-docked container. The checking and error states are mutually
 * exclusive by construction (a check clears the last error on start).
 */
export function PreflightStatusBoxes() {
  const { t } = useTranslation()
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const preflightError = useProjectStore(state => state.preflightError)

  return (
    <>
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
    </>
  )
}
