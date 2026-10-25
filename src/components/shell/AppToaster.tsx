import type { CSSProperties } from 'react'
import { CircleAlert, CircleCheck, Info, TriangleAlert, X } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Toaster } from 'sonner'

/** The palette follows PNDS's four themes, independently of OS appearance. */
export function AppToaster() {
  const { t, i18n } = useTranslation()
  return (
    <Toaster
      className="pnds-toaster"
      position="bottom-right"
      offset={64}
      mobileOffset={{ bottom: 64, left: 16, right: 16 }}
      dir={i18n.dir()}
      closeButton
      containerAriaLabel={t('toast.regionLabel')}
      toastOptions={{ closeButtonAriaLabel: t('toast.dismiss') }}
      icons={{
        success: <CircleCheck aria-hidden="true" />,
        info: <Info aria-hidden="true" />,
        warning: <TriangleAlert aria-hidden="true" />,
        error: <CircleAlert aria-hidden="true" />,
        close: <X aria-hidden="true" />,
      }}
      style={
        {
          '--width': '400px',
          '--normal-bg': 'var(--pnds-card)',
          '--normal-bg-hover': 'var(--pnds-pill-hover)',
          '--normal-text': 'var(--pnds-text)',
          '--normal-border': 'var(--pnds-border)',
        } as CSSProperties
      }
    />
  )
}
