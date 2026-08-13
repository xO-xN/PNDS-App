import { useTranslation } from 'react-i18next'
import { closeWindowWithFade, useWindowStore } from '@/store/window-store'
import { stopAndReset } from '@/lib/open-project'
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
 * §v1.1.1: the close-confirm dialog, drawn in the app's design system
 * (same AlertDialog as the switch-project popup) instead of the native
 * macOS alert. Opened by requestClose() when a session is live (⌘W / red
 * light). Confirm stops the session (score server + audio) then fades the
 * window out and hides it; the app keeps running and the Dock icon
 * reopens it (§7.4).
 */
export function CloseConfirmDialog() {
  const { t } = useTranslation()
  const open = useWindowStore(state => state.confirmCloseOpen)

  const confirmClose = async () => {
    // Close the dialog first so the UI doesn't hang while the session
    // stops, then stop and fade. Esc / overlay click just closes it.
    useWindowStore.getState().setConfirmCloseOpen(false)
    await stopAndReset()
    await closeWindowWithFade()
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next) useWindowStore.getState().setConfirmCloseOpen(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('close.confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('close.confirmMessage')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('close.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirmClose()}>
            {t('close.stopAndHide')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
