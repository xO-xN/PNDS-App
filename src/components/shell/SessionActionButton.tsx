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
import { useWindowStore } from '@/store/window-store'
import {
  isSessionBusy,
  isSessionLive,
  selectionIsRunningCard,
  useSessionStore,
} from '@/store/session-store'
import {
  onPerformanceCloseRequest,
  onPerformanceConfirmationCancel,
  onPerformanceLoadRequest,
} from '@/lib/performance-selection'
import { projectDisplayName } from '@/lib/display-names'
import { hasOpenOverlay, isEditableTarget } from '@/hooks/use-command-keyboard'
import { cn } from '@/lib/utils'
import { DesktopActionGlass } from './DesktopActionGlass'

type SessionAction = 'load' | 'reload' | 'close' | 'node'
interface ReplacementConfirmation {
  kind: 'switch'
  inputs: StartGateInputs
  runId: number
}

interface CloseConfirmation {
  kind: 'close'
  runId: number
  projectPath: string
  selectedPath: string | null
}

type Confirmation = ReplacementConfirmation | CloseConfirmation

function confirmationMatches(
  confirmation: Confirmation | null,
  inputs: StartGateInputs,
  runId: number
): boolean {
  return (
    confirmation?.kind === 'switch' &&
    confirmation.runId === runId &&
    Object.entries(confirmation.inputs).every(([key, value]) =>
      Object.is(value, inputs[key as keyof StartGateInputs])
    )
  )
}

function readCloseTarget(): CloseConfirmation | null {
  const session = useSessionStore.getState()
  const creation = useCreationStore.getState()
  const windowState = useWindowStore.getState()
  if (
    session.sessionStatus !== 'ready' ||
    !session.sessionProjectPath ||
    session.commandPending ||
    creation.active ||
    creation.opening ||
    creation.modePhase !== 'idle' ||
    usePerformanceRoleStore.getState().role !== 'host' ||
    useSettingsStore.getState().settingsOpen ||
    windowState.confirmCloseOpen ||
    windowState.quitConfirmOpen ||
    hasOpenOverlay()
  )
    return null
  return {
    kind: 'close',
    runId: session.runId,
    projectPath: session.sessionProjectPath,
    selectedPath: useProjectStore.getState().currentProject?.path ?? null,
  }
}

function closeTargetMatches(
  armed: Confirmation | null,
  target: CloseConfirmation | null
): boolean {
  return (
    armed?.kind === 'close' &&
    target !== null &&
    armed.runId === target.runId &&
    armed.projectPath === target.projectPath &&
    armed.selectedPath === target.selectedPath
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
 * close-project alias was retired. ⌘W arms and confirms Close in this
 * button, and Escape cancels the pending confirmation.
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
  const confirmation = useRef<Confirmation | null>(null)
  const [armed, setArmed] = useState<Confirmation['kind'] | null>(null)
  const closeArmed = armed === 'close'

  const confirmClose = () => {
    const target = readCloseTarget()
    const matches = closeTargetMatches(confirmation.current, target)
    confirmation.current = null
    setArmed(null)
    if (matches) void stopAndReset()
  }

  const requestClose = useEffectEvent(() => {
    const target = readCloseTarget()
    if (closeTargetMatches(confirmation.current, target)) {
      confirmClose()
    } else {
      confirmation.current = target
      setArmed(target?.kind ?? null)
    }
  })
  useEffect(() => onPerformanceCloseRequest(() => requestClose()), [])

  useEffect(() => {
    const cancel = () => {
      confirmation.current = null
      setArmed(null)
    }
    // Subscribe at the mutation boundary: a selection/configuration changing
    // away and back in one React batch still retires the first authorization.
    const validate = () => {
      if (confirmation.current?.kind === 'close') {
        if (!closeTargetMatches(confirmation.current, readCloseTarget()))
          cancel()
      } else if (
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
      useWindowStore.subscribe(validate),
    ]
    const offCancel = onPerformanceConfirmationCancel(buttonRoot, cancel)
    window.addEventListener('focusin', validate)
    return () => {
      unsubscribe.forEach(off => off())
      offCancel()
      window.removeEventListener('focusin', validate)
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
  const action = closeArmed ? 'close' : busy ? settledAction : availableAction
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
        setArmed(null)
        void startReplacing({
          projectPath: inputs.sessionProjectPath,
          selectedPath: inputs.currentProject.path,
          runId: currentRun,
        })
      } else {
        confirmation.current = { kind: 'switch', inputs, runId: currentRun }
        setArmed('switch')
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
      if (busy || confirmation.current?.kind === 'close') return
      if (event.key !== 'Enter') return
      // The global Enter alias only starts or reloads a project.
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

  const label = busy
    ? busyLabel
    : closeArmed
      ? t('closeProject.pressAgain')
      : action === 'close'
        ? t('sidebar.closeProject')
        : action === 'reload'
          ? t('sidebar.reloadProject')
          : action === 'node'
            ? t(
                inlineHostNaming
                  ? 'participation.ui.nameSetupTitle'
                  : 'sidebar.setupNode'
              )
            : armed === 'switch'
              ? t('session.confirmSwitch')
              : t('sidebar.loadProject')

  const submit = () => {
    if (closeArmed || confirmation.current?.kind === 'close') {
      confirmClose()
      return
    }
    switch (action) {
      case 'close':
        void stopAndReset()
        break
      case 'reload':
        void restart()
        break
      case 'node':
        if (inlineHostNaming) {
          document.getElementById('host-node-name')?.focus()
        } else useSettingsStore.getState().openSettings('node')
        break
      case 'load':
        submitLoad()
        break
    }
  }

  const tone =
    action === 'close'
      ? 'danger'
      : action === 'node'
        ? 'warning'
        : action === 'reload' || loadable
          ? 'primary'
          : 'neutral'

  return (
    <div ref={buttonRoot} className="desktop-session-action-root">
      <button
        type="button"
        disabled={busy || (action === 'load' && !loadable)}
        aria-busy={busy}
        data-busy={busy}
        data-testid={action === 'node' ? 'setup-node-button' : undefined}
        data-performance-action={action}
        data-close-armed={closeArmed || undefined}
        aria-keyshortcuts={closeArmed ? 'Meta+W' : undefined}
        aria-pressed={action === 'load' ? armed === 'switch' : undefined}
        aria-label={
          armed === 'switch'
            ? t('session.confirmSwitchTo', {
                name: displayName(currentProject?.path, ''),
              })
            : undefined
        }
        onClick={submit}
        data-session-action={action === 'load' && loadable ? 'load' : undefined}
        data-desktop-tone={tone}
        className={cn(
          'desktop-session-action desktop-performance-action pnds-focus-ring h-10 w-full text-[14px] transition-colors disabled:cursor-default',
          {
            danger:
              'bg-(--pnds-danger) text-(--pnds-danger-foreground) hover:bg-(--pnds-danger-hover)',
            warning:
              'bg-(--pnds-warning) text-(--pnds-warning-foreground) hover:bg-(--pnds-warning-hover)',
            primary:
              'bg-(--pnds-accent) text-(--pnds-accent-foreground) hover:bg-(--pnds-accent-hover)',
            neutral: 'bg-(--pnds-text)/6 text-(--pnds-text)/30',
          }[tone]
        )}
      >
        <DesktopActionGlass
          ambient={action === 'load' || action === 'reload'}
        />
        {label}
      </button>
      <span aria-live="polite" className="sr-only">
        {closeArmed ? t('closeProject.shortcutAnnouncement') : ''}
      </span>
      {action === 'load' && lanMissing && (
        <p
          className="desktop-session-lan-hint text-muted-foreground px-3 pb-2 pt-1.5 text-center text-xs"
          data-testid="lan-missing-hint"
        >
          {t('sidebar.lanMissingHint')}
        </p>
      )}
    </div>
  )
}
