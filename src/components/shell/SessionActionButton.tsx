import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { stopAndReset } from '@/lib/open-project'
import { canStart, start, restart, startReplacing } from '@/lib/session-flow'
import { useProjectStore } from '@/store/project-store'
import {
  isSessionBusy,
  isSessionLive,
  selectionIsRunningCard,
  useSessionStore,
} from '@/store/session-store'
import { projectDisplayName } from '@/lib/display-names'
import { hasOpenOverlay, isEditableTarget } from '@/hooks/use-command-keyboard'
import { cn } from '@/lib/utils'
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
 * Sidebar session action (§8). Selecting a project only preflights it.
 *
 * Rendered as the full-bleed footer of the settings card. v1.2.3 (#39/T4):
 * the footer follows the SELECTION — the running card keeps Close/Change
 * and the live volume rows, while any other selected card shows its own
 * pending start config with a Load button. Loading B over a live session
 * asks once ("will first close the running project") and then stops the
 * old session and starts B in one go; an `error` session is already dead
 * and starts without asking.
 *
 * v1.1.2: Enter is a keyboard alias for the submit — Load when idle and
 * loadable, Change/restart while a pending config change waits. v1.2.0:
 * ⌘Enter is the same alias (no macOS system conflict), the plain-Esc
 * close-project alias was retired — Esc has no app function; ⌘W opens
 * the close-project confirmation while a session runs (see menu.ts).
 */
export function SessionActionButton() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const sessionProjectPath = useSessionStore(state => state.sessionProjectPath)
  const projectDisplayNames = useProjectStore(
    state => state.projectDisplayNames
  )
  const manifestProjectNames = useProjectStore(
    state => state.manifestProjectNames
  )
  const audioMode = useSessionStore(state => state.audioMode)
  const lanIp = useSessionStore(state => state.lanIp)
  const oscTargetInput = useSessionStore(state => state.oscTargetInput)
  const deviceError = useSessionStore(state => state.deviceError)
  const pendingChanges = useSessionStore(state => state.pendingChanges)
  const [confirmSwitchOpen, setConfirmSwitchOpen] = useState(false)

  const running = sessionStatus === 'ready'
  const busy = isSessionBusy(sessionStatus)
  const live = isSessionLive(sessionStatus)
  // v1.2.3 (#39/T4): false while a different card is selected over a live
  // session — the footer then belongs to that card's pending start config.
  const runningCardSelected = selectionIsRunningCard(
    { sessionStatus, sessionProjectPath },
    currentProject?.path
  )
  /** The confirm dialog names both cards as the sidebar lists them —
   * rename overrides first (v1.2.3 #39/T4 review). */
  const displayName = (path: string | null | undefined, fallback: string) =>
    path
      ? projectDisplayName(
          path,
          projectDisplayNames,
          manifestProjectNames,
          currentProject
        )
      : fallback
  const loadable = canStart({
    currentProject,
    preflightStatus,
    sessionStatus,
    lanIp,
    audioMode,
    oscTargetInput,
    deviceError,
    selectionIsRunningCard: runningCardSelected,
  })

  /** Load/Enter submit: confirm-and-replace over a live session, plain
   * start otherwise (idle, or a dead `error` the Retry semantics cover). */
  const submitLoad = () => {
    if (live && !runningCardSelected) {
      setConfirmSwitchOpen(true)
      return
    }
    void start()
  }

  const confirmSwitch = async () => {
    setConfirmSwitchOpen(false)
    await startReplacing()
  }

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      // v1.2.0: ⌘Enter aliases the Enter submit — macOS reserves no
      // system-wide ⌘Enter chord and no app-menu accelerator here claims
      // it, so the webview receives it. Ctrl/Alt+Enter stay rejected.
      const enter = event.key === 'Enter' && !event.ctrlKey && !event.altKey
      if ((event.metaKey || event.ctrlKey || event.altKey) && !enter) return
      if (isEditableTarget(event.target)) return
      // Radix owns the keys while a dialog or select popup is open.
      if (hasOpenOverlay()) return
      if (busy) return
      // v1.2.0: Esc no longer does anything app-level — closing the
      // project behind a confirm is ⌘W's job (menu.ts).
      if (event.key !== 'Enter') return
      // Enter never stops a live show — Close stays dialog/mouse-only.
      if (running && !pendingChanges && runningCardSelected) return
      if (runningCardSelected) {
        if (!running && !loadable) return
        event.preventDefault()
        // v1.2.2 (#29 feedback): capture-phase + stopPropagation — a
        // focused control must not swallow the alias. With focus on the
        // device select, a bubble-phase window listener ran only after
        // Radix had opened the popup (hasOpenOverlay then bailed), so
        // the first Enter opened the popup instead of Change.
        event.stopPropagation()
        void (running ? restart() : start())
        return
      }
      // v1.2.3 (#39/T4): Enter loads the SELECTED card — over a live
      // session it opens the same confirm-and-replace as the button.
      if (!loadable) return
      event.preventDefault()
      event.stopPropagation()
      if (live) {
        setConfirmSwitchOpen(true)
      } else {
        void start()
      }
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [running, busy, pendingChanges, loadable, runningCardSelected, live])

  // Full-bleed footer: the card clips the bottom corners, so no radius
  // and no shadow here — the card owns both.
  const baseClass = 'h-10 w-full text-[14px] transition-colors'

  // Close (the running card is selected, no pending change)
  if (running && runningCardSelected && !pendingChanges) {
    return (
      <button
        type="button"
        onClick={() => void stopAndReset()}
        className={cn(
          baseClass,
          'bg-(--pnds-danger) text-(--pnds-danger-foreground) hover:bg-(--pnds-danger-hover)'
        )}
      >
        {t('sidebar.closeProject')}
      </button>
    )
  }

  // Change (the running card is selected, pending config changes — no
  // preflight gate; restart handles its own validation)
  if (running && runningCardSelected && pendingChanges) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void restart()}
        className={cn(
          baseClass,
          'bg-(--pnds-warning) text-(--pnds-warning-foreground) hover:bg-(--pnds-warning-hover)'
        )}
      >
        {busy ? t('session.stopping') : t('sidebar.change')}
      </button>
    )
  }

  // Load (idle, a dead error, or another card selected over a live session)
  const label =
    sessionStatus === 'starting'
      ? t('session.starting')
      : sessionStatus === 'stopping'
        ? t('session.stopping')
        : t('sidebar.loadProject')

  return (
    <>
      <button
        type="button"
        disabled={!loadable || busy}
        onClick={submitLoad}
        className={cn(
          baseClass,
          loadable
            ? 'bg-(--pnds-accent) text-(--pnds-accent-foreground) hover:bg-(--pnds-accent-hover)'
            : 'bg-(--pnds-text)/6 text-(--pnds-text)/30'
        )}
      >
        {label}
      </button>

      {/* v1.2.3 (#39/T4): loading a different project over a live session
          is an explicit, named authorization — the running show stops. */}
      <AlertDialog
        open={confirmSwitchOpen}
        onOpenChange={openState => {
          if (!openState) setConfirmSwitchOpen(false)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('startOver.title', {
                name: displayName(currentProject?.path, ''),
              })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('startOver.description', {
                running: displayName(sessionProjectPath, ''),
              })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('startOver.cancel')}</AlertDialogCancel>
            {/* autoFocus makes the primary (filled) action the Enter
                default — Radix would otherwise focus the first tabbable,
                which is Cancel. */}
            <AlertDialogAction autoFocus onClick={() => void confirmSwitch()}>
              {t('startOver.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  )
}
