import { useTranslation } from 'react-i18next'
import {
  resolveHttpsCompatChoice,
  useHttpsCompatDialog,
} from '@/lib/session-flow'
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
 * #140: the explicit legacy-HTTP choice — shown when the entry switch is
 * on but the selected project has not declared `supportsPerformerUrl`.
 * The trusted-HTTPS entry will NOT be active for this run; proceeding
 * means the operator consciously starts it over plain HTTP (phones lose
 * the secure context sensors need). Cancel aborts the start untouched.
 * Resolves through `resolveHttpsCompatChoice`; the start verbs hold
 * their submit latch while the choice is pending.
 */
export function HttpsCompatDialog() {
  const { t } = useTranslation()
  const open = useHttpsCompatDialog(state => state.open)

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next) resolveHttpsCompatChoice(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('httpsCompat.title')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('httpsCompat.message')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel onClick={() => resolveHttpsCompatChoice(false)}>
            {t('httpsCompat.cancel')}
          </AlertDialogCancel>
          {/* autoFocus makes the proceed action the Enter default — the
              operator already chose to start; this dialog only makes the
              HTTP fallback conscious. */}
          <AlertDialogAction
            autoFocus
            onClick={() => resolveHttpsCompatChoice(true)}
            data-testid="https-compat-proceed"
          >
            {t('httpsCompat.startHttp')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
