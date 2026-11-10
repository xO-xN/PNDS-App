import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { stopAndReset } from '@/lib/open-project'
import {
  canStartNowFrom,
  canLoadSelectedProject,
  lanAddressMissingFrom,
  nodeGateBlocked,
  readStartGateInputs,
  restart,
  start,
  startReplacing,
  submitSelectedProjectLoad,
  useStartGateInputs,
  type StartGateInputs,
} from '@/lib/session-flow'
import { useProjectStore } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { useCreationStore } from '@/store/creation-store'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import {
  isSessionBusy,
  isSessionLive,
  selectionIsRunningCard,
  useSessionStore,
} from '@/store/session-store'
import { onPerformanceLoadRequest } from '@/lib/performance-selection'
import { projectDisplayName } from '@/lib/display-names'
import { hasOpenOverlay, isEditableTarget } from '@/hooks/use-command-keyboard'
import { cn } from '@/lib/utils'
import { DesktopActionGlass } from './DesktopActionGlass'

type SessionAction = 'load' | 'reload' | 'close' | 'node'
interface ReplacementConfirmation {
  inputs: StartGateInputs
  runId: number
}

function confirmationMatches(
  confirmation: ReplacementConfirmation | null,
  inputs: StartGateInputs,
  runId: number
): boolean {
  return (
    confirmation !== null &&
    confirmation.runId === runId &&
    Object.entries(confirmation.inputs).every(([key, value]) =>
      Object.is(value, inputs[key as keyof StartGateInputs])
    )
  )
}

/**
 * Sidebar session action (§8). Selecting a project only preflights it.
 *
 * Rendered as the full-bleed footer of the settings card. v1.2.3 (#39/T4):
 * the footer follows the SELECTION — the running card keeps Close/Reload
 * and the live volume rows, while any other selected card shows its own
 * pending start config with a Load button. Loading B over a live session
 * asks for a second click in the same button and then stops the
 * old session and starts B in one go; an `error` session is already dead
 * and starts without asking.
 *
 * v1.1.2: Enter is a keyboard alias for the submit — Load when idle and
 * loadable, Reload/restart while a pending config change waits. v1.2.0:
 * ⌘Enter is the same alias (no macOS system conflict), the plain-Esc
 * close-project alias was retired — Esc has no app function; ⌘W opens
 * the close-project confirmation while a session runs (see menu.ts).
 *
 * #58: a telematic-declared selection with incomplete node config turns
 * the button into「设置节点」(routes to the settings Node section) — see
 * the render branch below. Enter never starts through the gate: the
 * verdict flows into `canStartNowFrom`.
 */
export function SessionActionButton() {
  const { t } = useTranslation()
  // The gate's every input, one subscription. The verdict below derives
  // FROM these values on purpose: the React Compiler memoizes any
  // derivation it cannot see dependencies for, and the zero-arg
  // `getState()` readers are invisible to it — a `canStartNow()` call in
  // render froze at its boot verdict (user report 2026-09-08). Keeping
  // inputs + verdict in session-flow means a new gate input updates one
  // file and no consumer can miss its re-render subscription.
  const gate = useStartGateInputs()
  const currentProject = gate.currentProject
  const sessionStatus = gate.sessionStatus
  const projectDisplayNames = useProjectStore(
    state => state.projectDisplayNames
  )
  const manifestProjectNames = useProjectStore(
    state => state.manifestProjectNames
  )
  const pendingChanges = useSessionStore(state => state.pendingChanges)
  const pendingPreflightPath = useProjectStore(
    state => state.pendingPreflightPath
  )
  const buttonRoot = useRef<HTMLDivElement>(null)
  const confirmation = useRef<ReplacementConfirmation | null>(null)
  const [armed, setArmed] = useState(false)

  useEffect(() => {
    const cancel = () => {
      confirmation.current = null
      setArmed(false)
    }
    // Subscribe at the mutation boundary: a selection/configuration changing
    // away and back in one React batch still retires the first authorization.
    const validate = () => {
      if (
        confirmation.current &&
        (!confirmationMatches(
          confirmation.current,
          readStartGateInputs(),
          useSessionStore.getState().runId
        ) ||
          !canLoadSelectedProject())
      )
        cancel()
    }
    const unsubscribe = [
      useProjectStore.subscribe(validate),
      useSessionStore.subscribe(validate),
      useSettingsStore.subscribe(validate),
      useCreationStore.subscribe(validate),
      usePerformanceRoleStore.subscribe(validate),
    ]
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        !buttonRoot.current?.contains(event.target)
      )
        cancel()
    }
    window.addEventListener('keydown', key)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('blur', cancel)
    return () => {
      unsubscribe.forEach(off => off())
      window.removeEventListener('keydown', key)
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('blur', cancel)
    }
  }, [])

  const running = sessionStatus === 'ready'
  const busy =
    isSessionBusy(sessionStatus) ||
    gate.modeSwitchBlocked === true ||
    gate.commandPending === true
  const live = isSessionLive(sessionStatus)
  // #58: the「设置节点」gate — a telematic-declared selection whose
  // App-global node config is incomplete. Replaces the Load/Reload forms
  // (Close survives — a running session must stay closable); completing
  // the config in the routed settings section restores them. Completeness
  // only, never connectivity. One derivation (session-flow) for the
  // button, the Enter alias and every start path.
  const nodeGated = nodeGateBlocked(gate)
  const inlineHostNaming =
    gate.performanceRole === 'host' &&
    !gate.nodeNameSetting.trim() &&
    sessionStatus === 'idle'
  // v1.2.3 (#39/T4): false while a different card is selected over a live
  // session — the footer then belongs to that card's pending start config.
  const runningCardSelected = selectionIsRunningCard(
    {
      sessionStatus,
      sessionProjectPath: gate.sessionProjectPath,
    },
    currentProject?.path
  )
  /** The confirmation names the selected card as the sidebar lists it —
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
  const loadable = canStartNowFrom(gate) && pendingPreflightPath === null
  // #147 (user report): a gray Load with no explanation reads as a dead
  // button. When the LAN address is the missing gate input, say so under
  // the button instead — the only reachable case post-fix is a machine
  // with no usable address at all (the first-address auto-pick fills
  // everything else). The busy transition keeps its own label.
  const lanMissing = !busy && lanAddressMissingFrom(gate)

  const availableAction: SessionAction =
    running && runningCardSelected && !pendingChanges
      ? 'close'
      : nodeGated && !busy
        ? 'node'
        : running && runningCardSelected
          ? 'reload'
          : 'load'
  const [settledAction, setSettledAction] = useState(availableAction)
  // Restart clears pendingChanges before the first stopping snapshot. Keep
  // the settled decoration while busy. Busy copy follows the real lifecycle:
  // a menu-driven stop must never promise that the project will restart.
  if (!busy && settledAction !== availableAction)
    setSettledAction(availableAction)
  const action = busy ? settledAction : availableAction
  const busyLabel =
    sessionStatus === 'starting' || !live
      ? t('session.starting')
      : t('session.stopping')

  /** Load/Enter submit: confirm-and-replace over a live session, plain
   * start otherwise (idle, or a dead `error` the Retry semantics cover). */
  const submitLoad = () =>
    submitSelectedProjectLoad(() => {
      const inputs = readStartGateInputs()
      if (!inputs.currentProject) return
      const currentRun = useSessionStore.getState().runId
      if (
        canLoadSelectedProject() &&
        confirmationMatches(confirmation.current, inputs, currentRun)
      ) {
        confirmation.current = null
        setArmed(false)
        void startReplacing({
          projectPath: inputs.sessionProjectPath,
          selectedPath: inputs.currentProject.path,
          runId: currentRun,
        })
      } else {
        confirmation.current = { inputs, runId: currentRun }
        setArmed(true)
      }
    })

  const requestLoad = useEffectEvent(submitLoad)
  useEffect(() => onPerformanceLoadRequest(() => requestLoad()), [])

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        if (
          event.key === 'Enter' &&
          event.target instanceof Element &&
          event.target.closest('[data-performance-action]')
        )
          event.preventDefault()
        return
      }
      // v1.2.0: ⌘Enter aliases the Enter submit — macOS reserves no
      // system-wide ⌘Enter chord and no app-menu accelerator here claims
      // it, so the webview receives it. Ctrl/Alt+Enter stay rejected.
      const enter = event.key === 'Enter' && !event.ctrlKey && !event.altKey
      if ((event.metaKey || event.ctrlKey || event.altKey) && !enter) return
      if (isEditableTarget(event.target)) return
      // Mode and role controls own Enter's native button activation,
      // including the first confirmation before their phase gates are set.
      if (
        event.target instanceof Element &&
        event.target.closest(
          '[data-mode-switch], .performance-role-switch, [role="tab"]'
        )
      )
        return
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
      requestLoad()
    }
    window.addEventListener('keydown', handleKeyDown, true)
    return () => window.removeEventListener('keydown', handleKeyDown, true)
  }, [running, busy, pendingChanges, loadable, runningCardSelected])

  // Full-bleed footer: the card clips the bottom corners, so no radius
  // and no shadow here — the card owns both.
  const baseClass =
    'desktop-session-action desktop-performance-action pnds-focus-ring h-10 w-full text-[14px] transition-colors disabled:cursor-default'

  // Close (the running card is selected, no pending change) — #58: Close
  // survives the「设置节点」gate; wiping the node config mid-show must not
  // strand the running session without a stop control.
  if (action === 'close') {
    return (
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        data-busy={busy}
        data-performance-action={action}
        data-desktop-tone="danger"
        onClick={() => void stopAndReset()}
        className={cn(
          baseClass,
          'bg-(--pnds-danger) text-(--pnds-danger-foreground) hover:bg-(--pnds-danger-hover)'
        )}
      >
        <DesktopActionGlass />
        {busy ? busyLabel : t('sidebar.closeProject')}
      </button>
    )
  }

  // #58:「设置节点」(declared selection, incomplete node config) — the
  // button routes to the settings Node section instead of starting; the
  // Load/Reload forms return once the three fields are filled. It yields
  // to a busy transition (starting/stopping): the session keeps its
  // busy-state visual, and the gate takes the button back when it settles.
  if (action === 'node') {
    return (
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        data-busy={busy}
        data-performance-action={action}
        data-testid="setup-node-button"
        data-desktop-tone="warning"
        onClick={() => {
          if (inlineHostNaming) {
            document.getElementById('host-node-name')?.focus()
          } else useSettingsStore.getState().openSettings('node')
        }}
        className={cn(
          baseClass,
          'bg-(--pnds-warning) text-(--pnds-warning-foreground) hover:bg-(--pnds-warning-hover)'
        )}
      >
        <DesktopActionGlass />
        {busy
          ? busyLabel
          : t(
              inlineHostNaming
                ? 'participation.ui.nameSetupTitle'
                : 'sidebar.setupNode'
            )}
      </button>
    )
  }

  // Reload (the running card is selected, pending config changes — no
  // preflight gate; restart handles its own validation)
  if (action === 'reload') {
    return (
      <button
        type="button"
        disabled={busy}
        aria-busy={busy}
        data-busy={busy}
        data-performance-action={action}
        data-desktop-tone="primary"
        onClick={() => void restart()}
        className={cn(
          baseClass,
          'bg-(--pnds-accent) text-(--pnds-accent-foreground) hover:bg-(--pnds-accent-hover)'
        )}
      >
        <DesktopActionGlass ambient />
        {busy ? busyLabel : t('sidebar.reloadProject')}
      </button>
    )
  }

  // Load (idle, a dead error, or another card selected over a live session)
  const label = busy
    ? busyLabel
    : armed
      ? t('session.confirmSwitch')
      : t('sidebar.loadProject')

  return (
    <div ref={buttonRoot} className="desktop-session-action-root">
      <button
        type="button"
        disabled={!loadable || busy}
        aria-busy={busy}
        data-busy={busy}
        data-performance-action={action}
        aria-pressed={armed}
        aria-label={
          armed
            ? t('session.confirmSwitchTo', {
                name: displayName(currentProject?.path, ''),
              })
            : undefined
        }
        onClick={submitLoad}
        data-session-action={loadable ? 'load' : undefined}
        data-desktop-tone={loadable ? 'primary' : 'neutral'}
        className={cn(
          baseClass,
          loadable
            ? 'bg-(--pnds-accent) text-(--pnds-accent-foreground) hover:bg-(--pnds-accent-hover)'
            : 'bg-(--pnds-text)/6 text-(--pnds-text)/30'
        )}
      >
        <DesktopActionGlass ambient />
        {label}
      </button>
      {lanMissing && (
        <p
          className="text-muted-foreground px-3 pb-2 pt-1.5 text-center text-xs"
          data-testid="lan-missing-hint"
        >
          {t('sidebar.lanMissingHint')}
        </p>
      )}
    </div>
  )
}
