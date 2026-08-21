import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Volume2, VolumeX } from 'lucide-react'
import { toast } from 'sonner'
import { useProjectStore } from '@/store/project-store'
import { isSessionLive, useSessionStore } from '@/store/session-store'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import {
  isValidOscTarget,
  updateOscTarget,
  updatePreferences,
  SYSTEM_DEFAULT_DEVICE,
} from '@/lib/preferences'
import {
  fixedGainFrom,
  setMasterVolumeTo,
  toggleMasterMute,
  volumeAdjustableAt,
} from '@/lib/volume-control'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { CSSProperties } from 'react'

const MODE_LABELS: Record<string, string> = {
  internal: 'Internal Synth',
  external: 'External Synth',
  none: 'None',
}

let missingDeviceWarned = false

/**
 * Sidebar settings card (§10.2), rendered as the body of the card whose
 * footer is the session action button.
 *
 * The layout encodes the one distinction that matters here: master volume
 * is live (it hits the running master synth on drag), everything below the
 * rule is deferred — the new value shows immediately but is NOT applied
 * until the user presses the footer button (Load / Change, §8.3). The
 * deferred rows therefore sit directly above the button that applies them.
 *
 * OSC target is hidden unless the selected mode is "external" (§6.6).
 */
export interface SettingsCardProps {
  /** Overlay mode: report while any popup menu is open so the host can
   * keep the floating sidebar visible (Radix portals leave the sidebar
   * element, which would otherwise trigger its mouse-leave auto-hide). */
  onPopupOpenChange?: (open: boolean) => void
}

export function SettingsCard({ onPopupOpenChange }: SettingsCardProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const sessionProjectPath = useSessionStore(state => state.sessionProjectPath)
  const audioMode = useSessionStore(state => state.audioMode)
  const lanIp = useSessionStore(state => state.lanIp)
  const lanAddresses = useSessionStore(state => state.lanAddresses)
  const outputDevice = useSessionStore(state => state.outputDevice)
  const oscTargetInput = useSessionStore(state => state.oscTargetInput)
  const [devices, setDevices] = useState<
    {
      name: string
      isDefault: boolean
      maxOutputChannels: number
    }[]
  >([])
  // §6.3: capability failure lives in the store so canStart can gate Load.
  const deviceError = useSessionStore(state => state.deviceError)

  // v1.2.3 (#39/T4): the settings rows follow the SELECTION. While a
  // different card is selected over a live session, the deferred rows hold
  // that card's pending start config (seeded by its preflight); the volume
  // row belongs to the RUNNING session and waits (adjusting it means going
  // back to the running card — the persistent mini-control is future work).
  const selectionOnRunningCard =
    !isSessionLive(sessionStatus) || currentProject?.path === sessionProjectPath

  const modes = currentProject?.manifest.audio.supportedModes ?? []
  const projectLoaded = currentProject !== null
  const volume = useSessionStore(state => state.volume)
  const muted = useSessionStore(state => state.muted)
  const oscTargetValid = isValidOscTarget(oscTargetInput)

  // §3.3: outputChannels defaults to 2 when the manifest omits it.
  const projectChannels = currentProject?.manifest.audio.outputChannels ?? 2
  // §7.6: device capabilities are relative to the project sample rate.
  const sampleRate = currentProject?.manifest.audio.scsynth?.sampleRate ?? null
  // §6.3: the device list only matters for internal mode; anything else is
  // a safe empty state (nothing to gate, nothing to show).
  const deviceQueryActive =
    projectLoaded && audioMode === 'internal' && sampleRate !== null

  useEffect(() => {
    // §6.3: without an internal project the list is a safe empty state —
    // the render guards below ignore any stale list, so no state reset here.
    const rate = sampleRate
    if (!deviceQueryActive || rate === null) return
    let stale = false
    void commands.listOutputDevices(rate).then(result => {
      // §6.3: a fast project switch must not let the old sample rate's
      // response overwrite the new selection.
      if (stale) return
      if (result.status !== 'ok') {
        logger.warn('Failed to list output devices', { error: result.error })
        setDevices([])
        useSessionStore.getState().setDeviceError(result.error)
        return
      }
      setDevices(result.data.devices)
      useSessionStore.getState().setDeviceError(null)
      const saved = useSessionStore.getState().outputDevice
      if (
        saved !== SYSTEM_DEFAULT_DEVICE &&
        !result.data.devices.some(device => device.name === saved) &&
        !missingDeviceWarned
      ) {
        missingDeviceWarned = true
        useSessionStore.getState().setOutputDevice(SYSTEM_DEFAULT_DEVICE)
        void updatePreferences({ outputDevice: null })
        toast.info(
          `Saved output device "${saved}" is not available; using the system default.`
        )
      }
    })
    return () => {
      stale = true
    }
  }, [deviceQueryActive, sampleRate])

  // §6.3: capability of the currently selected entry — the system default
  // row reflects the real default device's channels.
  const selectedDefaultChannels = devices.find(
    device => device.isDefault
  )?.maxOutputChannels
  const selectedChannels =
    outputDevice === SYSTEM_DEFAULT_DEVICE
      ? selectedDefaultChannels
      : devices.find(device => device.name === outputDevice)?.maxOutputChannels
  const insufficient =
    deviceQueryActive &&
    selectedChannels !== undefined &&
    selectedChannels < projectChannels

  // §7.5 (#30): the fixed-gain / adjustable derivations live in
  // volume-control as pure functions; subscribing with them keeps the
  // card, the ⌘M menu item and the ⌘←/⌘→ nudges on one shared gate.
  const fixedGain = useSessionStore(state =>
    fixedGainFrom(
      state.audioMode,
      state.channelPlan?.projectChannels,
      projectChannels
    )
  )
  // v1.2.3 (#39/T4): volume is the running session's live control — only
  // the running card (or no session at all) may adjust it.
  const volumeAdjustable = useSessionStore(state =>
    volumeAdjustableAt(state, projectChannels)
  )
  const volumeEnabled = selectionOnRunningCard && volumeAdjustable
  const volumeDisplay = fixedGain ? 100 : volume

  // A config change only flags the RUNNING session's Change button while
  // the running card is selected; editing another card's pending config
  // is pre-configuration, not a pending change.
  const flagChange = () => {
    if (selectionOnRunningCard && sessionStatus !== 'idle') {
      useSessionStore.getState().setPendingChanges(true)
    }
  }

  const handleModeChange = (mode: string) => {
    useSessionStore.getState().setAudioMode(mode)
    flagChange()
  }

  const handleVolumeChange = (percent: number) => {
    // The store keeps the mute state honest (drag >0 releases it, 0 is
    // muted) — the drag stays live, never deferred.
    setMasterVolumeTo(percent)
  }

  const handleMuteToggle = () => {
    toggleMasterMute()
  }

  const handleDeviceChange = (device: string) => {
    useSessionStore.getState().setOutputDevice(device)
    void updatePreferences({
      outputDevice: device === SYSTEM_DEFAULT_DEVICE ? null : device,
    })
    flagChange()
  }

  const commitOscTarget = () => {
    if (!oscTargetValid || !currentProject) return
    void updateOscTarget(currentProject.manifest.id, oscTargetInput)
    flagChange()
  }

  // Every row shares one label gutter, including the volume row (its icon
  // sits in the gutter) — so the left edge of the controls never jumps.
  const labelClass = 'w-12 shrink-0 text-[11px] text-(--pnds-text)/45'
  // Values are data, not chrome: full text strength. Greying them is what
  // reads as "disabled", so only the disabled state may do it.
  const fieldClass =
    'h-7 bg-(--pnds-pill) text-[12px] text-(--pnds-text) outline-none transition-colors hover:bg-(--pnds-pill-hover) disabled:text-(--pnds-text)/30 disabled:hover:bg-(--pnds-pill)'
  const selectClass = `${fieldClass} w-full appearance-none rounded-lg pl-2.5 pr-6`
  const hintRowClass =
    'flex items-center gap-2 pl-14 text-[11px] leading-tight text-(--pnds-danger)'

  return (
    <div
      data-testid="settings-card"
      className="flex flex-col gap-2 px-3.5 pb-3.5 pt-3"
    >
      {/* Master volume (§7.5: internal only; N>2 fixed at 100%/0dB — the
          slider greys out and shows 100; N<=2 keeps the dB-linear curve and
          80% default). Live — applied on drag, never deferred. The speaker
          is a click-to-mute toggle (#30): mute remembers the current value,
          a second click restores it; the state lives in the session store
          only, so every reopened session returns to the known 80%. */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            labelClass,
            'flex items-center',
            !volumeEnabled && 'opacity-45'
          )}
        >
          <button
            type="button"
            data-testid="mute-toggle"
            onClick={handleMuteToggle}
            disabled={!volumeEnabled}
            aria-label={muted ? t('sidebar.unmute') : t('sidebar.mute')}
            aria-pressed={muted}
            className={cn(
              'pnds-focus-ring -mx-2 flex size-7 items-center justify-center rounded-md',
              'transition-transform active:scale-90'
            )}
          >
            {muted ? <VolumeX size={14} /> : <Volume2 size={14} />}
          </button>
        </span>
        <input
          type="range"
          dir="ltr"
          aria-label={
            fixedGain ? t('sidebar.volumeFixed') : t('sidebar.volume')
          }
          min={0}
          max={100}
          value={Math.round(volumeDisplay)}
          disabled={!volumeEnabled}
          onChange={e => handleVolumeChange(Number(e.target.value))}
          style={
            {
              '--pnds-volume-fill': `${Math.round(volumeDisplay)}%`,
            } as CSSProperties
          }
          className="pnds-focus-ring pnds-volume-slider h-7 w-full rounded-full disabled:opacity-35"
        />
        <span
          data-testid="volume-value"
          className={cn(
            'font-manrope w-7 shrink-0 text-end text-[11px] tabular-nums',
            volumeEnabled ? 'text-(--pnds-text)/70' : 'text-(--pnds-text)/30'
          )}
        >
          {Math.round(volumeDisplay)}
        </span>
      </div>

      {/* Everything below is deferred until the footer button (§8.3). */}
      <hr className="my-0.5 border-(--pnds-text)/10" />

      {/* Audio mode (§6.1): Radix Select like the device row. */}
      <div className="flex items-center gap-2">
        <span className={labelClass}>Synth</span>
        <div className="relative flex-1">
          <Select
            value={audioMode}
            onValueChange={handleModeChange}
            onOpenChange={open => onPopupOpenChange?.(open)}
            disabled={!projectLoaded}
          >
            <SelectTrigger
              aria-label={t('session.audioMode')}
              className={cn(
                selectClass,
                'border-0 shadow-none focus-visible:ring-0'
              )}
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent side="top">
              {modes.length === 0 && (
                <SelectItem value="__placeholder__" disabled>
                  —
                </SelectItem>
              )}
              {modes.map(mode => (
                <SelectItem key={mode} value={mode}>
                  {MODE_LABELS[mode] ?? mode}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* OSC target (§6.6) — a sub-setting of external mode, so it follows
          the mode row rather than leading the card. */}
      {audioMode === 'external' && (
        <div className="flex items-center gap-2">
          <span className={labelClass}>OSC</span>
          <input
            aria-label={t('sidebar.oscTarget')}
            value={oscTargetInput}
            disabled={!projectLoaded}
            onChange={e => {
              useSessionStore.getState().setOscTargetInput(e.target.value)
              // Don't flag for pending — wait until the user commits on blur/enter.
            }}
            onBlur={commitOscTarget}
            onKeyDown={e => {
              if (e.key === 'Enter') commitOscTarget()
            }}
            className={cn(
              fieldClass,
              'font-manrope w-full rounded-lg px-2.5',
              !oscTargetValid && 'ring-1 ring-(--pnds-danger)'
            )}
          />
        </div>
      )}

      {/* Output device (§6.3): each entry shows its channel count at the
          project sample rate; entries with fewer channels than the project
          instead carry the red "Nch → Hch" loss text as their marker, stay
          selectable (no real disabled state) and get an sr-only explanation.
          The persistent loss indicator in the CLOSED trigger is just a
          small red dot (v1.2.0: a full badge used to widen the trigger's
          right side and crowd the device name) — the specifics live in the
          dot's tooltip/sr-only text and in the opened list. Preference
          only — deferred until Change. */}
      <div className="flex items-center gap-2">
        <span className={labelClass}>Device</span>
        <div className="relative flex-1">
          <Select
            value={outputDevice}
            onValueChange={handleDeviceChange}
            onOpenChange={open => onPopupOpenChange?.(open)}
            disabled={!deviceQueryActive}
          >
            <SelectTrigger
              aria-label={t('sidebar.outputDevice')}
              className={cn(
                selectClass,
                'border-0 shadow-none focus-visible:ring-0'
              )}
            >
              <span className="flex min-w-0 flex-1 items-center justify-between gap-1.5 text-start">
                <span className="truncate">
                  {outputDevice === SYSTEM_DEFAULT_DEVICE
                    ? t('sidebar.systemDefault')
                    : outputDevice}
                </span>
                {insufficient && (
                  <span
                    data-testid="device-insufficient-hint"
                    title={t('sidebar.deviceInsufficient', {
                      projectChannels,
                      deviceChannels: selectedChannels,
                    })}
                    className="flex shrink-0 items-center"
                  >
                    <span
                      aria-hidden="true"
                      className="size-1.5 rounded-full bg-(--pnds-danger)"
                    />
                    <span className="sr-only">
                      {t('sidebar.deviceInsufficient', {
                        projectChannels,
                        deviceChannels: selectedChannels,
                      })}
                    </span>
                  </span>
                )}
              </span>
            </SelectTrigger>
            <SelectContent side="top">
              {deviceQueryActive && (
                <>
                  <SelectItem value={SYSTEM_DEFAULT_DEVICE}>
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate">
                        {t('sidebar.systemDefault')}
                      </span>
                      {selectedDefaultChannels !== undefined && (
                        <span className="shrink-0 text-(--pnds-text)/45">
                          {t('sidebar.deviceChannelCount', {
                            channels: selectedDefaultChannels,
                          })}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                  {devices.map(device => {
                    const insufficient =
                      device.maxOutputChannels < projectChannels
                    return (
                      <SelectItem
                        key={device.name}
                        value={device.name}
                        className={cn(
                          'pr-9',
                          insufficient && 'opacity-40 hover:opacity-60'
                        )}
                      >
                        <span className="flex min-w-0 flex-1 items-center gap-1.5">
                          <span className="truncate">{device.name}</span>
                          <span
                            className={cn(
                              'shrink-0',
                              insufficient
                                ? 'font-manrope text-[10px] leading-none font-semibold text-(--pnds-danger)'
                                : 'text-(--pnds-text)/45'
                            )}
                          >
                            {insufficient
                              ? t('sidebar.deviceInsufficient', {
                                  projectChannels,
                                  deviceChannels: device.maxOutputChannels,
                                })
                              : t('sidebar.deviceChannelCount', {
                                  channels: device.maxOutputChannels,
                                })}
                          </span>
                          {insufficient && (
                            <span className="sr-only">
                              {t('sidebar.deviceInsufficientHint', {
                                deviceChannels: device.maxOutputChannels,
                                projectChannels,
                                loss:
                                  projectChannels - device.maxOutputChannels,
                              })}
                            </span>
                          )}
                        </span>
                      </SelectItem>
                    )
                  })}
                </>
              )}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* §6.3: capability query failed — readable inline error, Load stays
          gated (canStart) until the query succeeds. */}
      {deviceError && audioMode === 'internal' && projectLoaded && (
        <div data-testid="device-error" className={hintRowClass}>
          {t('sidebar.deviceListFailed')}
        </div>
      )}

      {/* LAN address (replaces Figma — §7: explicit choice required).
          Always visible: the row is shown even with a single address so
          it never disappears between preflight states; the select is
          disabled only when no address is known yet. */}
      <div className="flex items-center gap-2">
        <span className={labelClass}>LAN</span>
        <div className="relative flex-1">
          <Select
            value={lanIp ?? ''}
            onValueChange={ip => {
              useSessionStore.getState().setLanIp(ip)
              flagChange()
            }}
            onOpenChange={open => onPopupOpenChange?.(open)}
            disabled={lanAddresses.length === 0}
          >
            <SelectTrigger
              aria-label={t('session.lanAddress')}
              className={cn(
                selectClass,
                'border-0 shadow-none focus-visible:ring-0',
                'font-manrope'
              )}
            >
              {lanIp ?? t('session.lanAddressHint')}
            </SelectTrigger>
            <SelectContent side="top">
              {lanAddresses.map(ip => (
                <SelectItem key={ip} value={ip}>
                  {ip}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
    </div>
  )
}
