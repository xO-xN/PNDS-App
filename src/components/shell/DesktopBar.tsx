import { useEffect, useState, type CSSProperties } from 'react'
import { useTranslation } from 'react-i18next'
import {
  Speaker,
  Globe,
  Settings,
  Projector,
  RefreshCw,
  Volume2,
  VolumeX,
  Terminal,
} from 'lucide-react'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { useProjectionStore } from '@/store/projection-store'
import { CreationModeButton } from '@/components/creation/CreationModeButton'
import { CreationTestControls } from '@/components/creation/CreationTestControls'
import { AudioSection } from '@/components/settings/AudioSection'
import { NodeSection } from '@/components/settings/NodeSection'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { refreshMonitorFromDisk } from '@/lib/creation-runtime-updates'
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
import { SettingsCard } from './SettingsCard'
import { SessionActionButton } from './SessionActionButton'

/** Shared live controls deliberately follow the runtime, never another selected card. */
function MasterGain() {
  const { t } = useTranslation()
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
  return (
    <div className="desktop-gain" data-tauri-drag-region="false">
      <button
        type="button"
        data-tauri-drag-region="false"
        data-testid="mute-toggle"
        className="desktop-icon-button pnds-focus-ring active:opacity-70"
        disabled={!adjustable}
        aria-pressed={muted}
        aria-label={t(muted ? 'sidebar.unmute' : 'sidebar.mute')}
        onClick={toggleMasterMute}
      >
        {muted ? (
          <VolumeX aria-hidden="true" />
        ) : (
          <Volume2 aria-hidden="true" />
        )}
      </button>
      <input
        type="range"
        data-tauri-drag-region="false"
        dir="ltr"
        min={0}
        max={100}
        value={shown}
        disabled={!adjustable}
        aria-label={t(fixed ? 'sidebar.volumeFixed' : 'sidebar.volume')}
        onChange={event => setMasterVolumeTo(Number(event.target.value))}
        style={{ '--pnds-volume-fill': `${shown}%` } as CSSProperties}
        className="pnds-volume-slider pnds-focus-ring"
      />
      <span data-testid="volume-value">{shown}%</span>
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
  const creation = useCreationStore(state => state.active)
  const workspace = useCreationStore(state => state.workspace !== null)
  const expanded = useCreationTestStore(state => state.expanded)
  const tab = useCreationTestStore(state => state.tab)
  const status = useSessionStore(state => state.sessionStatus)
  const snapshot = useSessionStore(state => state.latestSnapshot)
  const device = useSessionStore(state => state.outputDevice)
  const lan = useSessionStore(state => state.lanIp)
  const rate = useSettingsStore(state => state.sampleRateSetting)
  const settingsOpen = useSettingsStore(state => state.settingsOpen)
  const projectionStarted = useSessionStore(state => state.projectionStarted)
  const projectionExists = useProjectionStore(state => state.windowExists)
  const projection = projectionStartButton(projectionExists, {
    status,
    projectionStarted,
  })
  const [audioOpen, setAudioOpen] = useState(false)
  const [networkOpen, setNetworkOpen] = useState(false)
  const [sessionDialogOpen, setSessionDialogOpen] = useState(false)
  useEffect(() => {
    onPopupOpenChange?.(audioOpen || networkOpen || sessionDialogOpen)
  }, [audioOpen, networkOpen, sessionDialogOpen, onPopupOpenChange])
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
  const output =
    live?.outputDevice ??
    (device === SYSTEM_DEFAULT_DEVICE ? t('sidebar.systemDefault') : device)
  const projectionLabel = t(
    projection.visible
      ? projection.started
        ? 'projection.withdrawAction'
        : 'projection.startAction'
      : 'sidebar.openProjection'
  )
  return (
    <footer
      className="desktop-bar"
      aria-label={t('desktop.controls')}
      data-tauri-drag-region="deep"
    >
      <div className="desktop-transport" data-tauri-drag-region="false">
        {creation ? (
          <CreationTestControls placement="bar" />
        ) : (
          <>
            <SessionActionButton onDialogOpenChange={setSessionDialogOpen} />
            <button
              type="button"
              data-tauri-drag-region="false"
              className="desktop-icon-button pnds-focus-ring active:opacity-70"
              disabled={status !== 'ready'}
              aria-label={t('sidebar.refresh')}
              title={t('sidebar.refreshHint')}
              onClick={() => void refreshMonitorFromDisk()}
            >
              <RefreshCw aria-hidden="true" />
            </button>
          </>
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
          >
            <Speaker aria-hidden="true" />
            <span className="desktop-device-name">{output}</span>
            {(live?.appliedSampleRate || !live) && (
              <small>{(live?.appliedSampleRate ?? rate) / 1000} kHz</small>
            )}
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="desktop-control-popover"
        >
          <AudioSection section="audio" />
        </PopoverContent>
      </Popover>
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
          >
            <Globe aria-hidden="true" />
            <bdi dir="ltr">{live?.lanIp ?? lan ?? '—'}</bdi>
          </button>
        </PopoverTrigger>
        <PopoverContent
          side="top"
          align="start"
          className="desktop-control-popover"
        >
          {live && (
            <p className="desktop-applied" role="status">
              {t('desktop.appliedNetwork', { address: live.lanIp ?? '—' })}
            </p>
          )}
          <SettingsCard showAudioMode={false} showGain={false} />
          <NodeSection section="node" compact />
          <button
            type="button"
            data-tauri-drag-region="false"
            className="desktop-settings-link pnds-focus-ring"
            onClick={() => useSettingsStore.getState().openSettings('node')}
          >
            {t('settings.node')}
          </button>
        </PopoverContent>
      </Popover>
      <div className="desktop-bar-spacer" />
      {creation && (
        <button
          type="button"
          data-tauri-drag-region="false"
          className="desktop-summary pnds-focus-ring active:opacity-70"
          aria-pressed={tab === 'console'}
          aria-label={t('creation.console')}
          disabled={!workspace || expanded}
          onClick={() =>
            useCreationTestStore
              .getState()
              .setTab(tab === 'console' ? 'file' : 'console')
          }
        >
          <Terminal aria-hidden="true" />
          <span className="desktop-optional-label">
            {t('creation.console')}
          </span>
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
        title={t('creation.settings')}
        onClick={() => useSettingsStore.getState().openSettings()}
      >
        <Settings aria-hidden="true" />
      </button>
      <CreationModeButton />
    </footer>
  )
}
