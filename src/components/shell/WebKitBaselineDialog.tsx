import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { openUrl } from '@tauri-apps/plugin-opener'
import { toast } from 'sonner'
import { useWebKitBaselineStore } from '@/store/webkit-baseline-store'
import { logger } from '@/lib/logger'
import { safariUpdateGuideUrl } from '@/lib/webkit-baseline'
import { Button } from '@/components/ui/button'
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
 * v1.4.2 (#110): the WebKit baseline gate dialog — when the system's
 * Safari (and with it the WebKit the app renders on) sits below the
 * 16.4 baseline, the startup check in @/lib/webkit-baseline flags the
 * store and this dialog states the problem and the way out. Same
 * AlertDialog family as the updater failure dialog (#60), mounted
 * outside AppShell so it's reachable in every window state. The primary
 * action opens Apple's update guide but deliberately keeps the dialog
 * open — on a below-baseline machine this dialog is the one surface
 * that is guaranteed to work.
 */
export function WebKitBaselineDialog() {
  const { t, i18n } = useTranslation()
  const belowBaselineVersion = useWebKitBaselineStore(
    state => state.belowBaselineVersion
  )

  // The detected Safari version is the one number that diagnoses this
  // dialog — WKWebView's UA is frozen at AppleWebKit/605.1.15 and would
  // only mislead, so it is deliberately not shown.
  const details =
    belowBaselineVersion === null ? '' : `Safari ${belowBaselineVersion}`

  const copyDetails = async () => {
    try {
      await writeText(details)
      toast.success(t('error.copied'))
    } catch (error) {
      logger.warn('Failed to copy WebKit baseline details', { error })
      toast.error(t('toast.error.generic'))
    }
  }

  const openUpdateGuide = async () => {
    try {
      await openUrl(safariUpdateGuideUrl(i18n.language))
    } catch (error) {
      logger.warn('Failed to open the Safari update guide', { error })
      toast.error(t('toast.error.generic'))
    }
  }

  return (
    <AlertDialog
      open={belowBaselineVersion !== null}
      onOpenChange={next => {
        if (!next) useWebKitBaselineStore.getState().clearBelowBaseline()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('webkit.belowBaselineTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {belowBaselineVersion !== null &&
              t('webkit.belowBaselineBody', { version: belowBaselineVersion })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            {t('webkit.detailsLabel')}
          </p>
          <pre
            data-testid="webkit-baseline-details"
            className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-start text-xs whitespace-pre-wrap break-all"
          >
            {details}
          </pre>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void copyDetails()}
          >
            {t('error.copy')}
          </Button>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('webkit.dismiss')}</AlertDialogCancel>
          {/* preventDefault keeps the dialog open after the guide opens —
              unlike the updater failure dialog, closing here would drop
              the only reliable surface on a below-baseline machine.
              autoFocus still makes the guide action the Enter default. */}
          <AlertDialogAction
            autoFocus
            onClick={event => {
              event.preventDefault()
              void openUpdateGuide()
            }}
          >
            {t('webkit.updateAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
