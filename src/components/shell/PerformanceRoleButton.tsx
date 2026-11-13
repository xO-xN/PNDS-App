import { useEffect, useId, useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronDown } from 'lucide-react'
import { notifications } from '@/lib/notifications'
import {
  usePerformanceRoleStore,
  type PerformanceRole,
} from '@/store/performance-role-store'
import { useSettingsStore } from '@/store/settings-store'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
} from '@/components/ui/dropdown-menu'
import {
  useClientParticipationStore,
  clientParticipationActive,
} from '@/store/client-participation-store'
import {
  useSessionStore,
  isSessionLive,
  isSessionBusy,
} from '@/store/session-store'

function roleSwitchBlocked() {
  const host = useSessionStore.getState()
  return (
    isSessionLive(host.sessionStatus) ||
    isSessionBusy(host.sessionStatus) ||
    host.commandPending ||
    clientParticipationActive(useClientParticipationStore.getState().snapshot)
  )
}

/** Explicit role selection; the native activity and cleanup gates still own admission. */
export function PerformanceRoleButton() {
  const { t, i18n } = useTranslation()
  const role = usePerformanceRoleStore(state => state.role)
  const open = usePerformanceRoleStore(state => state.roleMenuOpen)
  const pending = usePerformanceRoleStore(state => state.roleSwitchPending)
  const restoreFocus = usePerformanceRoleStore(state => state.restoreRoleFocus)
  const nodeName = useSettingsStore(state => state.nodeNameSetting.trim())
  const hostActive = useSessionStore(
    state =>
      isSessionLive(state.sessionStatus) ||
      isSessionBusy(state.sessionStatus) ||
      state.commandPending
  )
  const clientActive = useClientParticipationStore(state =>
    clientParticipationActive(state.snapshot)
  )
  const root = useRef<HTMLButtonElement>(null)
  const operation = useRef(0)
  const skipCloseFocus = useRef(false)
  const id = useId()
  const blocked = hostActive || clientActive || pending

  const setOpen = (next: boolean) => {
    if (next) skipCloseFocus.current = false
    if (!next) operation.current += 1
    usePerformanceRoleStore.setState({
      roleMenuOpen: next,
      ...(!next ? { roleSwitchPending: false } : {}),
    })
  }
  useEffect(() => {
    const cancel = () => {
      skipCloseFocus.current = true
      operation.current += 1
      usePerformanceRoleStore.setState({
        roleMenuOpen: false,
        roleSwitchPending: false,
      })
    }
    window.addEventListener('blur', cancel)
    return () => {
      window.removeEventListener('blur', cancel)
      operation.current += 1
      if (usePerformanceRoleStore.getState().role === role)
        usePerformanceRoleStore.setState({
          roleMenuOpen: false,
          roleSwitchPending: false,
        })
    }
  }, [role])
  useEffect(() => {
    if (restoreFocus) {
      root.current?.focus({ preventScroll: true })
      usePerformanceRoleStore.setState({ restoreRoleFocus: false })
    }
  }, [restoreFocus])

  const switchRole = async (target: PerformanceRole) => {
    const current = usePerformanceRoleStore.getState()
    if (
      current.role !== role ||
      target === current.role ||
      current.roleSwitchPending ||
      roleSwitchBlocked()
    )
      return
    const epoch = ++operation.current
    usePerformanceRoleStore.setState({ roleSwitchPending: true })
    const owns = () => {
      const state = usePerformanceRoleStore.getState()
      return (
        operation.current === epoch &&
        state.role === role &&
        state.roleSwitchPending
      )
    }
    if (
      role === 'client' &&
      !(await useClientParticipationStore.getState().leave())
    ) {
      if (owns()) usePerformanceRoleStore.setState({ roleSwitchPending: false })
      return
    }
    if (!owns()) return
    if (roleSwitchBlocked()) {
      usePerformanceRoleStore.setState({ roleSwitchPending: false })
      return
    }
    const saved = await usePerformanceRoleStore.getState().commitRole(target)
    if (!saved) notifications.error(t('participation.roleMemorySaveFailed'))
  }

  if (!role) return null
  return (
    <div className="performance-role-navigation">
      <DropdownMenu
        open={open}
        onOpenChange={setOpen}
        dir={i18n.dir(i18n.language)}
        modal={false}
      >
        <DropdownMenuTrigger asChild>
          <button
            ref={root}
            type="button"
            className="performance-role-switch pnds-focus-ring"
            aria-label={t('participation.roleMenuLabel', {
              role: t(`participation.${role}`),
            })}
            aria-describedby={nodeName ? `${id}-node` : undefined}
          >
            <span>{t(`participation.${role}`)}</span>
            <ChevronDown aria-hidden="true" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          className="performance-role-menu"
          align="start"
          sideOffset={5}
          onInteractOutside={() => {
            skipCloseFocus.current = true
          }}
          onCloseAutoFocus={event => {
            if (skipCloseFocus.current) event.preventDefault()
          }}
        >
          <DropdownMenuRadioGroup value={role}>
            {(['host', 'client'] as const).map(option => (
              <DropdownMenuRadioItem
                key={option}
                value={option}
                className="performance-role-menu-item"
                aria-label={t(`participation.${option}`)}
                aria-describedby={`${id}-${option}${blocked && option !== role ? ` ${id}-help` : ''}`}
                disabled={blocked && option !== role}
                onSelect={event => {
                  if (option === role) return
                  event.preventDefault()
                  void switchRole(option)
                }}
              >
                <span className="performance-role-menu-copy">
                  <strong>{t(`participation.${option}`)}</strong>
                  <small id={`${id}-${option}`}>
                    {t(`participation.${option}MenuDescription`)}
                  </small>
                </span>
              </DropdownMenuRadioItem>
            ))}
          </DropdownMenuRadioGroup>
          {blocked && (
            <p id={`${id}-help`} className="performance-role-menu-help">
              {t(
                pending
                  ? 'participation.ui.leavingHelp'
                  : role === 'host'
                    ? 'participation.stopBeforeRoleSwitch'
                    : 'participation.leaveBeforeRoleSwitch'
              )}
            </p>
          )}
        </DropdownMenuContent>
      </DropdownMenu>
      {nodeName && (
        <span
          id={`${id}-node`}
          className="performance-role-node-name"
          title={nodeName}
        >
          <bdi>{nodeName}</bdi>
        </span>
      )}
    </div>
  )
}
