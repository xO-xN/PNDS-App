import { useTranslation } from 'react-i18next'
import {
  prepareTerminalQuitConfirmation,
  quitNow,
  useWindowStore,
} from '@/store/window-store'
import { stopAndReset } from '@/lib/open-project'
import { useState } from 'react'
import { useSessionStore, shouldConfirmClose } from '@/store/session-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { useCreationStore } from '@/store/creation-store'
import {
  blockCreationTerminalOpen,
  useCreationTerminalStore,
} from '@/store/creation-terminal-store'
import { endCreationTerminalForLeave } from '@/lib/creation-terminal-leave'
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
  const terminal = useCreationTerminalStore(state => state.hasSession)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [detail, setDetail] = useState<string | null>(null)

  const confirmQuit = async (save: boolean) => {
    if (busy) return
    setBusy(true)
    setError(null)
    setDetail(null)
    const releaseTerminal = blockCreationTerminalOpen()
    const creation = useCreationStore.getState()
    const workspace = creation.workspace
    const current = () =>
      useCreationStore.getState().active === creation.active &&
      useCreationStore.getState().workspace?.project === workspace?.project
    const runtime = useSessionStore.getState()
    let failure = 'creation.terminal.endFailed'
    try {
      const draftsUnchanged = captureCreationDrafts()
      const pending = prepareTerminalQuitConfirmation()
      const approval = pending ? await pending : null
      if ((pending && !approval) || !current() || !draftsUnchanged()) return
      if (useCreationTerminalStore.getState().hasSession)
        await endCreationTerminalForLeave(
          useCreationTerminalStore.getState().identity ?? ''
        )
      failure = 'quit.saveFailed'
      if (!current() || !draftsUnchanged()) {
        setError(failure)
        return
      }
      if (save && !(await saveCreationDrafts())) {
        setError(failure)
        return
      }
      if (!current()) {
        setError(failure)
        return
      }
      failure = 'close.stopFailed'
      const latestRuntime = useSessionStore.getState()
      if (
        latestRuntime.runId !== runtime.runId ||
        latestRuntime.sessionStatus !== runtime.sessionStatus ||
        latestRuntime.sessionProjectPath !== runtime.sessionProjectPath ||
        latestRuntime.latestSnapshot?.runtimeGeneration !==
          runtime.latestSnapshot?.runtimeGeneration ||
        (live &&
          !(await stopAndReset(runtime.latestSnapshot?.runtimeGeneration)))
      ) {
        setError(failure)
        return
      }
      failure = 'quit.saveFailed'
      if (
        !current() ||
        (!save && !draftsUnchanged()) ||
        !(await quitNow(!save && count > 0, approval))
      ) {
        setError(failure)
        return
      }
      useWindowStore.getState().setQuitConfirmOpen(false)
    } catch (cause) {
      setError(failure)
      setDetail(String(cause))
    } finally {
      setBusy(false)
      releaseTerminal()
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
            {t(
              count
                ? 'quit.draftsTitle'
                : terminal && !live
                  ? 'creation.terminal.quitTitle'
                  : 'quit.confirmTitle'
            )}
          </AlertDialogTitle>
          <AlertDialogDescription>
            {t(
              count
                ? 'quit.draftsMessage'
                : terminal && !live
                  ? 'creation.terminal.quitMessage'
                  : 'quit.confirmMessage',
              { appName: t('app.name'), count }
            )}
          </AlertDialogDescription>
          {terminal && (count > 0 || live) && (
            <p className="text-sm">{t('creation.terminal.quitConsequence')}</p>
          )}
        </AlertDialogHeader>
        {count > 0 && !creationDraftsCanSave() && (
          <p>{t('quit.handoffDrafts')}</p>
        )}
        {error && (
          <p role="alert">
            {t(error)}
            {detail && (
              <span className="block whitespace-pre-wrap">{detail}</span>
            )}
          </p>
        )}
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
            {t(
              count
                ? 'quit.discardAndQuit'
                : terminal && !live
                  ? 'creation.terminal.endQuit'
                  : 'quit.stopAndQuit'
            )}
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
