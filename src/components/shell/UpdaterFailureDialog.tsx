import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { toast } from 'sonner'
import { useUpdaterStore } from '@/store/updater-store'
import { openReleasesPage } from '@/lib/updater'
import { logger } from '@/lib/logger'
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
 * v1.4.0 (issue #60): the update failure dialog — manual-path check
 * failures render here through the manual renderer in updater-store,
 * instead of the old toast treatment. v1.4.3 (#121): check-only removed
 * the install phase, so every failure is a check failure. The full
 * reason text is shown selectable and one click copies it; the primary
 * action opens the Releases page so a failed check always has a way
 * out. Same AlertDialog family as the close/quit confirms, mounted
 * outside AppShell so it is reachable in every window state.
 */
export function UpdaterFailureDialog() {
  const { t } = useTranslation()
  const failure = useUpdaterStore(state => state.failure)

  const copyDetails = async () => {
    if (!failure) return
    try {
      await writeText(failure.reason)
      toast.success(t('error.copied'))
    } catch (error) {
      logger.warn('Failed to copy updater failure details', { error })
      toast.error(t('toast.error.generic'))
    }
  }

  return (
    <AlertDialog
      open={failure !== null}
      onOpenChange={next => {
        if (!next) useUpdaterStore.getState().clearUpdaterFailure()
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('updater.checkFailedTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('updater.failureBody')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="flex flex-col gap-2">
          <p className="text-muted-foreground text-xs">
            {t('updater.failureDetailsLabel')}
          </p>
          <pre
            data-testid="updater-failure-reason"
            className="max-h-40 overflow-auto rounded-md bg-muted p-2 text-start text-xs whitespace-pre-wrap break-all"
          >
            {failure?.reason}
          </pre>
          <Button
            variant="outline"
            size="sm"
            className="self-start"
            onClick={() => void copyDetails()}
          >
            {t('updater.failureCopyAction')}
          </Button>
        </div>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('updater.failureDismiss')}</AlertDialogCancel>
          {/* autoFocus makes the primary action the Enter default, same
              rule as the close/quit confirms. */}
          <AlertDialogAction autoFocus onClick={() => void openReleasesPage()}>
            {t('updater.failureReleasesAction')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
