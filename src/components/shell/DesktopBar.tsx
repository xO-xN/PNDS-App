import { PublicEntryDetails } from './PublicEntryDetails'
import { CreationEntryDetails } from './CreationEntryDetails'
import { useCreationTestEntry } from '@/hooks/use-creation-test-entry'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useEffect, useId, useRef, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Speaker,
  Headphones,
  Wifi,
  EthernetPort,
  Globe,
  Settings,
  Projector,
  Volume2,
  VolumeX,
  Terminal,
  LoaderCircle,
  TriangleAlert,
  ArrowUpRight,
} from 'lucide-react'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useCreationCompileStore } from '@/store/creation-compile-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { useProjectionStore } from '@/store/projection-store'
import { CreationModeButton } from '@/components/creation/CreationModeButton'
import { CreationTestControls } from '@/components/creation/CreationTestControls'
import { AudioSection } from '@/components/settings/AudioSection'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { projectionStartButton } from '@/lib/projection-state'
import {
  openProjectionWindow,
  toggleProjectionGate,
} from '@/lib/projection-window'
import {
  fixedGainFrom,
  volumeAdjustableAt,
  setMasterVolumeTo,
  toggleMasterMute,
  appliedAudioMode,
} from '@/lib/volume-control'
import { SYSTEM_DEFAULT_DEVICE } from '@/lib/preferences'
import { creationTestOutput } from '@/lib/creation-test-audio'
import { useDesktopDeviceStatus } from '@/hooks/use-desktop-device-status'
import { SettingsCard } from './SettingsCard'
import { SessionActionButton } from './SessionActionButton'
import { useHostEntryStore } from '@/store/host-entry-store'
import { PerformanceRecording } from './PerformanceRecording'
import { useClientParticipationStore } from '@/store/client-participation-store'
import { useClientSidebarStore } from '@/store/client-sidebar-store'
import { ClientPerformanceAction } from './ClientParticipation'

/** Shared live controls deliberately follow the runtime, never another selected card. */
function MasterGain() {
  const { t } = useTranslation()
  const flyoutId = useId()
  const muteButton = useRef<HTMLButtonElement>(null)
  const [hovered, setHovered] = useState(false)
  const [keyboardFocused, setKeyboardFocused] = useState(false)
  const [dragging, setDragging] = useState(false)
  const volume = useSessionStore(state => state.volume)
  const muted = useSessionStore(state => state.muted)
  const adjustable = useSessionStore(state => volumeAdjustableAt(state, 2))
  const fixed = useSessionStore(state =>
    fixedGainFrom(
      appliedAudioMode(state),
      state.channelPlan?.projectChannels,
      2
    )
  )
  const shown = fixed ? 100 : Math.round(volume)
  const open = hovered || keyboardFocused || dragging

  useEffect(() => {
    if (!open) return
    const endDrag = () => setDragging(false)
    const clearInteraction = () => {
      endDrag()
      setHovered(false)
      setKeyboardFocused(false)
    }
    window.addEventListener('pointerup', endDrag, true)
    window.addEventListener('pointercancel', endDrag, true)
    window.addEventListener('blur', clearInteraction)
    return () => {
      window.removeEventListener('pointerup', endDrag, true)
      window.removeEventListener('pointercancel', endDrag, true)
      window.removeEventListener('blur', clearInteraction)
    }
  }, [open])

  return (
    <div
      className="desktop-gain"
      data-volume-open={open || undefined}
      data-tauri-drag-region="false"
      onPointerEnter={event => {
        if (event.pointerType !== 'touch') setHovered(true)
      }}
      onPointerLeave={event => {
        if (event.pointerType !== 'touch') setHovered(false)
      }}
      onPointerDownCapture={() => setKeyboardFocused(false)}
      onFocus={event => {
        if (event.target.matches(':focus-visible')) setKeyboardFocused(true)
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget))
          setKeyboardFocused(false)
      }}
      onKeyDown={event => {
        if (!open || event.key !== 'Escape') return
        event.preventDefault()
        event.stopPropagation()
        muteButton.current?.focus({ preventScroll: true })
        setHovered(false)
        setKeyboardFocused(false)
        setDragging(false)
      }}
    >
      <button
        ref={muteButton}
        type="button"
        data-tauri-drag-region="false"
        data-testid="mute-toggle"
        className="desktop-icon-button pnds-focus-ring active:opacity-70"
        disabled={!adjustable}
        aria-pressed={muted}
        aria-expanded={open}
        aria-controls={flyoutId}
        aria-label={t(muted ? 'sidebar.unmute' : 'sidebar.mute')}
        onClick={toggleMasterMute}
      >
        {muted ? (
          <VolumeX aria-hidden="true" />
        ) : (
          <Volume2 aria-hidden="true" />
        )}
      </button>

      <div
        id={flyoutId}
        className="desktop-gain-flyout"
        hidden={!open}
        data-native-overlay=""
        data-tauri-drag-region="false"
      >
        <div
          className="desktop-gain-panel desktop-surface-popover"
          data-tauri-drag-region="false"
        >
          <input
            type="range"
            data-tauri-drag-region="false"
            dir="ltr"
            min={0}
            max={100}
            value={shown}
            disabled={!adjustable}
            aria-label={t(fixed ? 'sidebar.volumeFixed' : 'sidebar.volume')}
            onPointerDown={event => {
              if (event.button === 0) setDragging(true)
            }}
            onChange={event => setMasterVolumeTo(Number(event.target.value))}
            style={{ '--pnds-volume-fill': `${shown}%` } as CSSProperties}
            className="pnds-volume-slider pnds-focus-ring"
          />
          <span data-testid="volume-value" data-tauri-drag-region="false">
            {shown}%
          </span>
        </div>
      </div>
    </div>
  )
}

/** Mounted once in AppShell so the same mode button survives both workspaces. */
export function DesktopBar({
  onPopupOpenChange,
}: {
  onPopupOpenChange?: (open: boolean) => void
}) {
  const { t } = useTranslation()
  const role = usePerformanceRoleStore(state => state.role)
  const clientHostName = useClientParticipationStore(state => {
    const { activeHost, host, pageUrl } = state.snapshot
    if (!pageUrl || !activeHost) return null
    return host?.hostId === activeHost.hostId
      ? host.nodeName
      : activeHost.nodeName
  })
  const clientSidebarVisible = useClientSidebarStore(state => state.visible)
  const clientSourceIsCreation = useClientParticipationStore(
    state => state.snapshot.activeHost?.role === 'creation'
  )
  const clientSidebarLabel = t(
    clientSourceIsCreation
      ? 'participation.ui.creationSidebarButton'
      : 'participation.ui.hostSidebarButton',
    { name: clientHostName }
  )
  const entry = useHostEntryStore(state => state.snapshot)
  const creation = useCreationStore(state => state.active)
  const testEntry = useCreationTestEntry()
  const project = useCreationStore(state => state.workspace?.project)
  const runtimeProject = useCreationStore(state => state.runtimeProject)
  const workspace = !!project
  const expanded = useCreationTestStore(state => state.expanded)
  const tab = useCreationTestStore(state => state.tab)
  const compiling = useCreationCompileStore(state => state.busy)
  const compileError = useCreationCompileStore(
    state => state.error ?? state.report?.error ?? null
  )
  const pending = useCreationFilesStore(state => state.pending)
  const pendingKinds = (['compile', 'refresh', 'restart'] as const).filter(
    kind => pending[kind] > 0
  )
  const consoleState = !workspace
    ? undefined
    : compiling
      ? 'compiling'
      : compileError
        ? 'error'
        : pendingKinds.length
          ? 'pending'
          : undefined
  const consoleStatus =
    consoleState === 'compiling'
      ? t('creation.consoleStatus.compiling')
      : consoleState === 'error'
        ? t('creation.consoleStatus.compileFailed')
        : consoleState === 'pending'
          ? pendingKinds
              .map(kind =>
                t(
                  {
                    compile: 'creation.consoleStatus.pendingCompile',
                    refresh: 'creation.consoleStatus.pendingRefresh',
                    restart: 'creation.consoleStatus.pendingRestart',
                  }[kind]
                )
              )
              .join(' · ')
          : undefined
  const consoleDescription = consoleState
    ? [
        compiling ? t('creation.compile.busy') : compileError,
        ...pendingKinds.map(kind =>
          t(
            {
              compile: 'creation.pendingCompile',
              refresh: 'creation.pendingRefresh',
              restart: 'creation.pendingRestart',
            }[kind]
          )
        ),
      ]
        .filter(Boolean)
        .join('\n')
    : undefined
  const status = useSessionStore(state => state.sessionStatus)
  const snapshot = useSessionStore(state => state.latestSnapshot)
  const device = useSessionStore(state => state.outputDevice)
  const lan = useSessionStore(state => state.lanIp)
  const rate = useSettingsStore(state => state.sampleRateSetting)
  const hideBottomBarText = useSettingsStore(state => state.hideBottomBarText)
  const settingsOpen = useSettingsStore(state => state.settingsOpen)
  const projectionStarted = useSessionStore(state => state.projectionStarted)
  const projectionExists = useProjectionStore(state => state.windowExists)
  const projection = projectionStartButton(projectionExists, {
    status,
    projectionStarted,
  })
  const [audioOpen, setAudioOpen] = useState(false)
  const [networkOpen, setNetworkOpen] = useState(false)
  const [recordingOpen, setRecordingOpen] = useState(false)
  useEffect(() => {
    onPopupOpenChange?.(audioOpen || networkOpen || recordingOpen)
  }, [audioOpen, networkOpen, recordingOpen, onPopupOpenChange])
  useEffect(
    () =>
      useSettingsStore.subscribe(state => {
        if (state.settingsOpen) {
          setAudioOpen(false)
          setNetworkOpen(false)
        }
      }),
    []
  )
  const live =
    status === 'ready' && snapshot?.status === 'ready' ? snapshot : null
  const creationOutput = creationTestOutput(
    project,
    runtimeProject,
    live,
    device
  )
  const output = creation
    ? (creationOutput ?? t('sidebar.systemDefault'))
    : (live?.outputDevice ??
      (device === SYSTEM_DEFAULT_DEVICE ? t('sidebar.systemDefault') : device))
  const deviceStatus = useDesktopDeviceStatus(
    creation
      ? creationOutput
      : live
        ? live.outputDevice
        : device === SYSTEM_DEFAULT_DEVICE
          ? null
          : device,
    live?.lanIp ?? lan,
    creation || !live || (live.audioMode === 'internal' && !!live.outputDevice)
  )
  const AudioIcon = deviceStatus.audio === 'headphones' ? Headphones : Speaker
  const NetworkIcon = {
    wifi: Wifi,
    ethernet: EthernetPort,
    unknown: Globe,
  }[deviceStatus.network]
  const projectionLabel = t(
    projection.visible
      ? projection.started
        ? 'projection.withdrawAction'
        : 'projection.startAction'
      : 'sidebar.openProjection'
  )
  const networkUrl = creation ? testEntry.url : entry.url
  const networkStatus = creation ? testEntry.status : entry.status
  const networkStatusText = creation
    ? t(
        testEntry.status === 'ready' && !testEntry.url
          ? 'creation.testEntry.unavailable'
          : `creation.testStatus.${testEntry.status}`
      )
    : t(`participation.publicEntry.${entry.status}`)
  const networkWarning =
    networkStatus === 'error' ||
    (creation && testEntry.status === 'ready' && !testEntry.url)
  const networkLabel = creation
    ? (networkUrl ?? (networkWarning ? null : networkStatusText))
    : networkUrl && new URL(networkUrl).hostname
  const networkControl = (
    <Popover
      open={networkOpen && !settingsOpen}
      onOpenChange={open => {
        setNetworkOpen(open)
        if (open) setAudioOpen(false)
      }}
    >
      <PopoverTrigger asChild>
        <button
          type="button"
          data-tauri-drag-region="false"
          className="desktop-summary pnds-focus-ring active:opacity-70"
          aria-label={t('sidebar.localNetwork')}
          data-interface-kind={deviceStatus.network}
          data-entry-status={networkStatus}
          aria-description={networkStatusText}
          title={
            networkWarning
              ? networkStatusText
              : (networkLabel ?? t('sidebar.localNetwork'))
          }
        >
          <NetworkIcon aria-hidden="true" />
          {networkLabel && (
            <bdi
              dir={networkUrl ? 'ltr' : 'auto'}
              className="desktop-public-entry-url desktop-optional-label"
            >
              {networkLabel}
            </bdi>
          )}
          {networkWarning && (
            <span className="desktop-entry-warning">
              <TriangleAlert aria-hidden="true" />
              <span className="desktop-optional-label">
                {networkStatusText}
              </span>
            </span>
          )}
        </button>
      </PopoverTrigger>

      <PopoverContent
        side="top"
        align="start"
        className="desktop-control-popover desktop-network-popover desktop-surface-popover"
      >
        <div className="desktop-control-body">
          {creation ? <CreationEntryDetails /> : <PublicEntryDetails compact />}
          <SettingsCard
            showAudioMode={false}
            showGain={false}
            quickNetwork
            networkFields="lan"
          />
        </div>
        <button
          type="button"
          data-tauri-drag-region="false"
          className="desktop-settings-link pnds-focus-ring"
          onClick={() => useSettingsStore.getState().openSettings('node')}
        >
          {t('settings.presentation.allNetwork')}
          <ArrowUpRight aria-hidden="true" />
        </button>
      </PopoverContent>
    </Popover>
  )
  if (!creation && role !== 'host')
    return (
      <footer
        className="desktop-bar"
        data-hide-detail-text={hideBottomBarText || undefined}
        aria-label={t('desktop.controls')}
        data-tauri-drag-region="deep"
      >
        {role === 'client' ? (
          <>
            <div
              className="desktop-transport"
              data-performance-transport=""
              data-tauri-drag-region="false"
            >
              <ClientPerformanceAction />
            </div>
            {clientHostName && (
              <button
                id="client-host-sidebar-button"
                type="button"
                data-tauri-drag-region="false"
                className="desktop-summary desktop-client-sidebar-toggle pnds-focus-ring active:opacity-70"
                aria-controls="performance-sidebar"
                aria-expanded={clientSidebarVisible}
                title={clientSidebarLabel}
                onClick={() => {
                  const sidebar = useClientSidebarStore.getState()
                  sidebar.setOpen(!sidebar.visible)
                }}
              >
                <span>{clientSidebarLabel}</span>
              </button>
            )}
          </>
        ) : (
          <span className="participation-bar-caption">
            {t('participation.ui.entryBar')}
          </span>
        )}
        {networkControl}
        <div className="desktop-bar-spacer" />
        <button
          type="button"
          data-tauri-drag-region="false"
          className="desktop-icon-button pnds-focus-ring"
          aria-label={t('creation.settings')}
          onClick={() => useSettingsStore.getState().openSettings()}
        >
          <Settings aria-hidden="true" />
        </button>
        <CreationModeButton />
      </footer>
    )
  return (
    <footer
      className="desktop-bar"
      data-hide-detail-text={hideBottomBarText || undefined}
      aria-label={t('desktop.controls')}
      data-tauri-drag-region="deep"
    >
      <div
        className="desktop-transport"
        data-performance-transport={!creation || undefined}
        data-tauri-drag-region="false"
      >
        {creation ? (
          <CreationTestControls placement="bar" />
        ) : (
          <SessionActionButton />
        )}
      </div>
      <MasterGain />
      <Popover
        open={audioOpen && !settingsOpen}
        onOpenChange={open => {
          setAudioOpen(open)
          if (open) setNetworkOpen(false)
        }}
      >
        <PopoverTrigger asChild>
          <button
            type="button"
            data-tauri-drag-region="false"
            className="desktop-summary pnds-focus-ring active:opacity-70"
            aria-label={t('settings.audio')}
            title={t('settings.audio')}
            data-device-kind={deviceStatus.audio}
          >
            <AudioIcon aria-hidden="true" />
            <span className="desktop-device-name desktop-optional-label">
              {output}
            </span>
            {(live?.appliedSampleRate || !live) && (
              <small className="desktop-optional-label">
                {(live?.appliedSampleRate ?? rate) / 1000} kHz
              </small>
            )}
          </button>
        </PopoverTrigger>

        <PopoverContent
          side="top"
          align="start"
          className="desktop-control-popover desktop-surface-popover desktop-audio-popover"
        >
          <div className="desktop-control-body">
            <AudioSection section="audio" compact />
          </div>
        </PopoverContent>
      </Popover>
      {networkControl}
      <div className="desktop-bar-spacer" />
      <PerformanceRecording onOpenChange={setRecordingOpen} />
      {creation && (
        <button
          type="button"
          data-tauri-drag-region="false"
          className="desktop-summary desktop-console-control pnds-focus-ring active:opacity-70"
          aria-pressed={tab === 'console'}
          aria-label={t('creation.console')}
          aria-description={consoleDescription}
          aria-busy={consoleState === 'compiling' || undefined}
          title={consoleDescription}
          data-console-state={consoleState}
          disabled={!workspace || expanded}
          onClick={() =>
            useCreationTestStore
              .getState()
              .setTab(tab === 'console' ? 'file' : 'console')
          }
        >
          {consoleState === 'compiling' ? (
            <LoaderCircle
              aria-hidden="true"
              className="animate-spin motion-reduce:animate-none"
            />
          ) : consoleState === 'error' ? (
            <TriangleAlert aria-hidden="true" />
          ) : (
            <Terminal aria-hidden="true" />
          )}
          <span className="desktop-optional-label">
            {t('creation.console')}
          </span>
          {consoleStatus && (
            <small className="desktop-console-status">{consoleStatus}</small>
          )}
        </button>
      )}
      {!creation && (
        <>
          <button
            type="button"
            data-tauri-drag-region="false"
            data-testid="open-projection-button"
            data-projection-state={
              projection.visible
                ? projection.started
                  ? 'active'
                  : 'standby'
                : undefined
            }
            className="desktop-summary pnds-focus-ring active:opacity-70"
            aria-label={projectionLabel}
            title={projectionLabel}
            aria-pressed={projection.visible ? projection.started : undefined}
            disabled={projection.visible && !projection.enabled}
            onClick={
              projection.visible
                ? toggleProjectionGate
                : () => void openProjectionWindow()
            }
          >
            <Projector aria-hidden="true" />
            <span className="desktop-optional-label">{projectionLabel}</span>
          </button>
        </>
      )}

      <button
        type="button"
        data-tauri-drag-region="false"
        className="desktop-icon-button pnds-focus-ring active:opacity-70"
        aria-label={t('creation.settings')}
        onClick={() => useSettingsStore.getState().openSettings()}
      >
        <Settings aria-hidden="true" />
      </button>

      <CreationModeButton />
    </footer>
  )
}
