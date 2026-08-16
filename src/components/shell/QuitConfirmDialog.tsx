import { useTranslation } from 'react-i18next'
import { quitNow, useWindowStore } from '@/store/window-store'
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
 * v1.1.2 T7 (spec issue #11): the ⌘Q confirm dialog, drawn in the app's
 * design system (same AlertDialog as the close/switch popups). Opened by
 * requestQuit() when a session is live. Confirm stops the session (score
 * server + audio) and then exits the process — no fade, per §7.4. Esc /
 * overlay click just closes it. Mounted outside AppShell so it is
 * reachable in every window state.
 */
export function QuitConfirmDialog() {
  const { t } = useTranslation()
  const open = useWindowStore(state => state.quitConfirmOpen)

  const confirmQuit = async () => {
    // Close the dialog first so the UI doesn't hang while the session
    // stops, then stop and exit.
    useWindowStore.getState().setQuitConfirmOpen(false)
    await stopAndReset()
    await quitNow()
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next) useWindowStore.getState().setQuitConfirmOpen(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('quit.confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('quit.confirmMessage', { appName: t('app.name') })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>{t('quit.cancel')}</AlertDialogCancel>
          <AlertDialogAction onClick={() => void confirmQuit()}>
            {t('quit.stopAndQuit')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
