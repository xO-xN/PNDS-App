import { useEffect } from 'react'
import { useTranslation } from 'react-i18next'
import { stopAndReset } from '@/lib/open-project'
import { canStart, start, restart } from '@/lib/session-flow'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { hasOpenOverlay, isEditableTarget } from '@/hooks/use-command-keyboard'
import { cn } from '@/lib/utils'

/**
 * Sidebar session action (§8). Selecting a project only preflights it.
 *
 * Rendered as the full-bleed footer of the settings card: the rows above
 * are all deferred, and this is their submit. In Welcome/Loading it is the
 * accent-colored Load once preflight + LAN are in place (§6.1, §7). While
 * the session runs it is a red Close — unless the user has changed a
 * setting (mode / device / LAN / OSC target), which turns it into an amber
 * Change (§8.3) that applies the pending config with a full restart.
 *
 * v1.1.2: Enter is a keyboard alias for the submit — Load when idle and
 * loadable, Change/restart while a pending config change waits. v1.1.2 T7
 * (spec issue #11): ⌘Esc is a keyboard alias for the red Close — it stops
 * a running, change-free session exactly like clicking the button. A lone
 * Esc only opens the close-project confirmation, so a stray press can
 * never stop a live show. The listener reuses the exact conditions below,
 * so key and click can never drift apart.
 */
export function SessionActionButton() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const preflightStatus = useProjectStore(state => state.preflightStatus)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const audioMode = useSessionStore(state => state.audioMode)
  const lanIp = useSessionStore(state => state.lanIp)
  const oscTargetInput = useSessionStore(state => state.oscTargetInput)
  const deviceError = useSessionStore(state => state.deviceError)
  const pendingChanges = useSessionStore(state => state.pendingChanges)

  const running = sessionStatus === 'ready'
  const busy = sessionStatus === 'starting' || sessionStatus === 'stopping'
  const loadable = canStart({
    currentProject,
    preflightStatus,
    sessionStatus,
    lanIp,
    audioMode,
    oscTargetInput,
    deviceError,
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) return
      if (event.ctrlKey || event.altKey) return
      if (isEditableTarget(event.target)) return
      // Radix owns the keys while a dialog or select popup is open.
      if (hasOpenOverlay()) return
      if (busy) return
      // v1.1.2 T7: ⌘Esc mirrors the red Close button — the running,
      // change-free state only. A lone Esc asks for confirmation instead
      // (the dialog renders in the Sidebar). Escaping an edit or a dialog
      // belongs to that element (the guards above already handed it over).
      if (event.key === 'Escape') {
        if (running && !pendingChanges) {
          event.preventDefault()
          if (event.metaKey) {
            void stopAndReset()
          } else {
            useProjectStore.getState().setConfirmCloseProjectOpen(true)
          }
        }
        return
      }
      if (event.metaKey) return
      if (event.key !== 'Enter') return
      // Enter never stops a live show — Close stays ⌘Esc/mouse-only.
      if (running && !pendingChanges) return
      if (running || loadable) {
        event.preventDefault()
        void (running ? restart() : start())
      }
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [running, busy, pendingChanges, loadable])

  // Full-bleed footer: the card clips the bottom corners, so no radius
  // and no shadow here — the card owns both.
  const baseClass = 'h-10 w-full text-[14px] transition-colors'

  // Close (running, no pending change)
  if (running && !pendingChanges) {
    return (
      <button
        type="button"
        onClick={() => void stopAndReset()}
        className={cn(
          baseClass,
          'bg-(--pnds-danger) text-white hover:bg-(--pnds-danger-hover)'
        )}
      >
        {t('sidebar.closeProject')}
      </button>
    )
  }

  // Change (running, pending config changes — no preflight gate; restart
  // handles its own validation)
  if (running && pendingChanges) {
    return (
      <button
        type="button"
        disabled={busy}
        onClick={() => void restart()}
        className={cn(
          baseClass,
          'bg-(--pnds-warning) text-(--pnds-text) hover:bg-(--pnds-warning-hover)'
        )}
      >
        {busy ? t('session.stopping') : t('sidebar.change')}
      </button>
    )
  }

  // Load (idle)
  const label =
    sessionStatus === 'starting'
      ? t('session.starting')
      : sessionStatus === 'stopping'
        ? t('session.stopping')
        : t('sidebar.loadProject')

  return (
    <button
      type="button"
      disabled={!loadable || busy}
      onClick={() => void start()}
      className={cn(
        baseClass,
        loadable
          ? 'bg-(--pnds-accent) text-white hover:bg-(--pnds-accent-hover)'
          : 'bg-(--pnds-text)/6 text-(--pnds-text)/30'
      )}
    >
      {label}
    </button>
  )
}
