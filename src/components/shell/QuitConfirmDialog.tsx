import { useTranslation } from 'react-i18next'
import { quitNow, useWindowStore } from '@/store/window-store'
import { stopAndReset } from '@/lib/open-project'
import { useState } from 'react'
import { useSessionStore, shouldConfirmClose } from '@/store/session-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import {
  captureCreationDrafts,
  creationUnsavedCount,
  creationDraftsCanSave,
  saveCreationDrafts,
} from '@/lib/creation-lifecycle'
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
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const pending = useSessionStore(state => state.commandPending)
  // Draft owners publish changes; the lifecycle registry supplies the combined count.
  useCreationFilesStore(state => state.drafts)
  useCreationHandoffStore(state => state.pending)
  const count = creationUnsavedCount()
  const live = shouldConfirmClose(sessionStatus)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const confirmQuit = async (save: boolean) => {
    if (busy) return
    setBusy(true)
    setError(null)
    let failure = 'quit.saveFailed'
    try {
      const draftsUnchanged = captureCreationDrafts()
      if (save && !(await saveCreationDrafts())) {
        setError(failure)
        return
      }
      failure = 'close.stopFailed'
      if (live && !(await stopAndReset())) {
        setError(failure)
        return
      }
      failure = 'quit.saveFailed'
      if (
        (!save && !draftsUnchanged()) ||
        !(await quitNow(!save && count > 0))
      ) {
        setError(failure)
        return
      }
      useWindowStore.getState().setQuitConfirmOpen(false)
    } catch {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }

  return (
    <AlertDialog
      open={open}
      onOpenChange={next => {
        if (!next && !busy) useWindowStore.getState().setQuitConfirmOpen(false)
      }}
    >
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>
            {t(count ? 'quit.draftsTitle' : 'quit.confirmTitle')}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(count ? 'quit.draftsMessage' : 'quit.confirmMessage', {
              appName: t('app.name'),
              count,
            })}
          </AlertDialogDescription>
        </AlertDialogHeader>
        {count > 0 && !creationDraftsCanSave() && (
          <p>{t('quit.handoffDrafts')}</p>
        )}
        {error && <p role="alert">{t(error)}</p>}
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>
            {t('quit.cancel')}
          </AlertDialogCancel>
          {/* autoFocus makes the primary (filled) action the Enter
              default — Radix would otherwise focus the first tabbable,
              which is Cancel. */}
          <AlertDialogAction
            autoFocus={!count}
            disabled={busy || pending}
            onClick={event => {
              event.preventDefault()
              void confirmQuit(false)
            }}
          >
            {t(count ? 'quit.discardAndQuit' : 'quit.stopAndQuit')}
          </AlertDialogAction>
          {count > 0 && (
            <AlertDialogAction
              disabled={busy || pending || !creationDraftsCanSave()}
              onClick={event => {
                event.preventDefault()
                void confirmQuit(true)
              }}
            >
              {t('quit.saveAndQuit')}
            </AlertDialogAction>
          )}
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  )
}
