import { useTranslation } from 'react-i18next'
import { closeWindowWithFade, useWindowStore } from '@/store/window-store'
import { stopAndReset } from '@/lib/open-project'
import { useState } from 'react'
import { useSessionStore } from '@/store/session-store'
import { useCreationStore } from '@/store/creation-store'
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
 * macOS alert. Opened by requestClose() when a session is live (the red
 * light — ⌘W owns the close-project confirm instead since v1.2.0).
 * Confirm stops the session (score server + audio) then fades the
 * window out and hides it; the app keeps running and the Dock icon
 * reopens it (§7.4).
 */
export function CloseConfirmDialog() {
  const { t } = useTranslation()
  const open = useWindowStore(state => state.confirmCloseOpen)
  const pending = useSessionStore(state => state.commandPending)
  const modePhase = useCreationStore(state => state.modePhase)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  const confirmClose = async () => {
    if (busy) return
    setBusy(true)
    setFailed(false)
    try {
      if (!(await stopAndReset())) {
        setFailed(true)
        return
      }
      useWindowStore.getState().setConfirmCloseOpen(false)
      await closeWindowWithFade()
    } catch {
      setFailed(true)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next && !busy) useWindowStore.getState().setConfirmCloseOpen(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{t('close.confirmTitle')}</AlertDialogTitle>
          <AlertDialogDescription>
            {t('close.confirmMessage')}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {failed && <p role="alert">{t('close.stopFailed')}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t('close.cancel')}
          </AlertDialogCancel>
          {/* autoFocus makes the primary (filled) action the Enter
              default — Radix would otherwise focus the first tabbable,
              which is Cancel. */}
          <AlertDialogAction
            autoFocus
            disabled={busy || pending || modePhase !== 'idle'}
            onClick={event => {
              event.preventDefault()
              void confirmClose()
            }}
          >
            {t('close.stopAndHide')}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
