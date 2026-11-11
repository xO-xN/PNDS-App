import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { commands } from '@/lib/tauri-bindings'
import {
  FALLBACK_SAMPLE_RATES,
  SYSTEM_DEFAULT_DEVICE,
  updatePreferences,
} from '@/lib/preferences'
import { logger } from '@/lib/logger'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { flagSessionConfigChange } from '@/lib/session-flow'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { cn } from '@/lib/utils'
import type { SettingsSection } from '@/store/settings-store'

import { SectionTitle } from './SectionTitle'

/** 48000 → "48 kHz", 44100 → "44.1 kHz" — compact enough for the row,
 * precise enough for the audio domain. */
function formatSampleRate(rate: number): string {
  return `${rate / 1000} kHz`
}

/** #58: the once-per-launch guard for the missing-saved-device toast — a
 * panel that reopens must not re-warn about the same absence. */
let missingDeviceWarned = false

/**
 * Issue #21: the settings Audio section — the App's global sample rate
 * (the sole audio authority since #20) as an inline select, the same
 * control pattern as the language setting.
 *
 * #58: the output device moved here from the sidebar settings card and
 * joined the rate's semantics — App-global preference, applied at the
 * NEXT project start. Both rows stay editable while a session runs: the
 * change persists immediately, the running session keeps the audio
 * configuration it was spawned with. Only actual Internal runtime differences
 * appear below the corresponding next-start field. The list
 * enumerates at the effective sample rate; each entry shows its channel
 * count there, channel-poor entries stay selectable with the red
 * `Nch → Hch` loss marker (§7.6).
 *
 * The offered rates are the standard rates supported across all enumerated
 * output devices (the backend dedupes, sorts ascending, and falls back to
 * the fixed standard list on enumeration failure — so this query can only
 * fail at the transport level, which degrades to the same list here).
 *
 * Query discipline like the Ports section: once on mount (= panel open,
 * Radix unmounts closed dialogs), no polling, and a taken-down panel
 * never applies a stale response.
 */
export function AudioSection({
  section,
  compact = false,
}: {
  section: SettingsSection
  compact?: boolean
}) {
  const { t } = useTranslation()
  const sampleRateSetting = useSettingsStore(state => state.sampleRateSetting)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const applied = useSessionStore(state =>
    state.sessionStatus === 'ready' && state.latestSnapshot?.status === 'ready'
      ? state.latestSnapshot
      : null
  )
  const outputDevice = useSessionStore(state => state.outputDevice)
  const creationActive = useCreationStore(state => state.active)
  const creationChannels = useCreationTestStore(
    state => state.manifest?.audio.outputChannels
  )
  const performanceChannels =
    useProjectStore(
      state => state.currentProject?.manifest.audio.outputChannels
    ) ?? 2
  const projectChannels = creationActive
    ? (creationChannels ?? 2)
    : performanceChannels
  const [rates, setRates] = useState<number[] | null>(null)
  const [devices, setDevices] = useState<
    { name: string; isDefault: boolean; maxOutputChannels: number }[]
  >([])

  const prefix = compact ? 'quick' : 'settings'
  const deviceId = `${prefix}-output-device`
  const rateId = `${prefix}-sample-rate`

  useEffect(() => {
    let stale = false
    void commands.listSupportedSampleRates().then(
      offered => {
        if (!stale) setRates(offered)
      },
      error => {
        if (stale) return
        logger.warn('Failed to list supported sample rates', { error })
        setRates([...FALLBACK_SAMPLE_RATES])
      }
    )
    return () => {
      stale = true
    }
  }, [])

  // #58: device capabilities at the EFFECTIVE sample rate — the rate row
  // below owns the rate, this list follows it. Re-queries when the rate
  // changes (the offered rates clamp it, so the query stays bounded).
  useEffect(() => {
    let stale = false
    void commands.listOutputDevices(sampleRateSetting).then(result => {
      if (stale) return
      if (result.status !== 'ok') {
        logger.warn('Failed to list output devices', { error: result.error })
        setDevices([])
        return
      }
      setDevices(result.data.devices)
      // A saved device the hardware no longer offers falls back to the
      // system default — once per launch, with a toast (the sidebar row
      // this replaces warned the same way).
      const saved = useSessionStore.getState().outputDevice
      if (
        saved !== SYSTEM_DEFAULT_DEVICE &&
        !result.data.devices.some(device => device.name === saved) &&
        !missingDeviceWarned
      ) {
        missingDeviceWarned = true
        useSessionStore.getState().setOutputDevice(SYSTEM_DEFAULT_DEVICE)
        void updatePreferences({ outputDevice: null })
        toast.warning(t('settings.deviceMissingTitle'), {
          description: t('settings.deviceMissingToast', { device: saved }),
        })
      }
    })
    return () => {
      stale = true
    }
    // t rides along: i18next's t is stable, so this never re-fires the
    // query — it only satisfies the dependency lint.
  }, [sampleRateSetting, t])

  // The fallback list covers the wait and the failure; a saved preference
  // the current hardware no longer offers stays visible (and selectable
  // as-is) rather than silently rendering a blank or wrong value.
  const offered = rates ?? FALLBACK_SAMPLE_RATES
  const options = offered.includes(sampleRateSetting)
    ? offered
    : [...offered, sampleRateSetting].sort((a, b) => a - b)

  // §7.6: capability of the currently selected entry — the system default
  // row reflects the real default device's channels.
  const defaultDevice = devices.find(device => device.isDefault)
  const selectedDefaultChannels = defaultDevice?.maxOutputChannels
  const selectedChannels =
    outputDevice === SYSTEM_DEFAULT_DEVICE
      ? selectedDefaultChannels
      : devices.find(device => device.name === outputDevice)?.maxOutputChannels
  const insufficient =
    selectedChannels !== undefined && selectedChannels < projectChannels
  const internal = applied?.audioMode === 'internal' ? applied : null
  // The snapshot names the device resolved at spawn; the preference may still
  // mean "system default". Wait for enumeration before comparing that policy.
  const resolvedDevice =
    outputDevice === SYSTEM_DEFAULT_DEVICE ? defaultDevice?.name : outputDevice
  const outputLabel =
    outputDevice === SYSTEM_DEFAULT_DEVICE
      ? `${t('sidebar.systemDefault')}${defaultDevice ? ` · ${defaultDevice.name}` : ''}`
      : outputDevice
  const deviceChanged =
    !!internal?.outputDevice &&
    !!resolvedDevice &&
    internal.outputDevice !== resolvedDevice
  const rateChanged =
    internal?.appliedSampleRate != null &&
    internal.appliedSampleRate !== sampleRateSetting

  return (
    <section
      id={`${prefix}-section-${section}`}
      aria-labelledby={compact ? undefined : `${prefix}-${section}-title`}
      aria-label={compact ? t('settings.audio') : undefined}
      data-compact={compact || undefined}
      className={cn('settings-section', compact && 'settings-section-compact')}
    >
      {!compact && (
        <SectionTitle
          id={`${prefix}-${section}-title`}
          className="settings-section-heading"
        >
          {t('settings.audio')}
        </SectionTitle>
      )}
      {!compact && (
        <div className="settings-runtime">
          <span data-running={sessionStatus === 'ready' || undefined}>
            {sessionStatus === 'starting'
              ? t('session.starting')
              : sessionStatus === 'stopping'
                ? t('session.stopping')
                : t(
                    sessionStatus === 'ready'
                      ? 'settings.presentation.running'
                      : 'settings.presentation.notRunning'
                  )}
          </span>
          {applied?.audioMode && (
            <span>
              {internal?.channelPlan
                ? t('settings.presentation.internalChannels', {
                    count: internal.channelPlan.projectChannels,
                  })
                : t(`sidebar.audioMode.${applied.audioMode}`)}
            </span>
          )}
        </div>
      )}
      {!compact &&
        (applied?.audioMode === 'external' ||
          applied?.audioMode === 'none') && (
          <p className="settings-notice">
            {t('settings.presentation.internalPreferences')}
          </p>
        )}
      {/* #58: output device (moved from the sidebar settings card) — the
          §7.6 display contract travels intact: channel counts per entry,
          channel-poor entries stay selectable with the red loss text, and
          the closed trigger carries the loss as a small red dot whose
          specifics live in its tooltip/sr-only text. Sits above the rate
          row (user-requested): the physical output comes first, the rate
          configures it. */}
      <div className="settings-field">
        <Label htmlFor={deviceId} className="settings-field-label">
          {t('settings.outputDevice')}
        </Label>
        <div className="settings-field-control">
          <Select
            value={outputDevice}
            onValueChange={device => {
              useSessionStore.getState().setOutputDevice(device)
              flagSessionConfigChange()
              void updatePreferences({
                outputDevice: device === SYSTEM_DEFAULT_DEVICE ? null : device,
              })
            }}
          >
            <SelectTrigger
              id={deviceId}
              aria-label={t('settings.outputDevice')}
              aria-describedby={
                !compact && deviceChanged ? `${deviceId}-current` : undefined
              }
              className="w-full min-w-0"
            >
              <span className="flex min-w-0 flex-1 items-center justify-between gap-1.5 text-start">
                <span className="truncate" title={outputLabel}>
                  {outputLabel}
                </span>
                {!compact && insufficient && (
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
            <SelectContent>
              <SelectItem value={SYSTEM_DEFAULT_DEVICE}>
                <span className="flex min-w-0 flex-1 items-center gap-1.5">
                  <span className="truncate">
                    {t('sidebar.systemDefault')}
                    {defaultDevice ? ` · ${defaultDevice.name}` : ''}
                  </span>
                  {selectedDefaultChannels !== undefined && (
                    <span className="shrink-0 text-(--pnds-text-secondary)">
                      {t('sidebar.deviceChannelCount', {
                        channels: selectedDefaultChannels,
                      })}
                    </span>
                  )}
                </span>
              </SelectItem>
              {devices.map(device => {
                const deviceInsufficient =
                  device.maxOutputChannels < projectChannels
                return (
                  <SelectItem
                    key={device.name}
                    value={device.name}
                    className={cn(
                      'pe-9',
                      deviceInsufficient && 'opacity-40 hover:opacity-60'
                    )}
                  >
                    <span className="flex min-w-0 flex-1 items-center gap-1.5">
                      <span className="truncate">{device.name}</span>
                      <span
                        className={cn(
                          'shrink-0',
                          deviceInsufficient
                            ? 'font-manrope text-[10px] leading-none font-semibold text-(--pnds-danger)'
                            : 'text-(--pnds-text-secondary)'
                        )}
                      >
                        {deviceInsufficient
                          ? t('sidebar.deviceInsufficient', {
                              projectChannels,
                              deviceChannels: device.maxOutputChannels,
                            })
                          : t('sidebar.deviceChannelCount', {
                              channels: device.maxOutputChannels,
                            })}
                      </span>
                      {deviceInsufficient && (
                        <span className="sr-only">
                          {t('sidebar.deviceInsufficientHint', {
                            deviceChannels: device.maxOutputChannels,
                            projectChannels,
                            loss: projectChannels - device.maxOutputChannels,
                          })}
                        </span>
                      )}
                    </span>
                  </SelectItem>
                )
              })}
            </SelectContent>
          </Select>
          {!compact && deviceChanged && (
            <p id={`${deviceId}-current`} className="settings-field-difference">
              {t('settings.presentation.currentValue', {
                value: internal?.outputDevice,
              })}
            </p>
          )}
        </div>
      </div>
      <div className="settings-field">
        <Label htmlFor={rateId} className="settings-field-label">
          {t('settings.sampleRate')}
        </Label>
        <div className="settings-field-control">
          <Select
            value={String(sampleRateSetting)}
            onValueChange={value => {
              const rate = Number(value)
              useSettingsStore.getState().setSampleRateSetting(rate)
              flagSessionConfigChange()
              void updatePreferences({ sampleRate: rate })
            }}
          >
            <SelectTrigger
              id={rateId}
              aria-describedby={
                !compact && rateChanged ? `${rateId}-current` : undefined
              }
              className="w-full min-w-0"
            >
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {options.map(rate => (
                <SelectItem key={rate} value={String(rate)}>
                  {formatSampleRate(rate)}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          {!compact && rateChanged && internal?.appliedSampleRate != null && (
            <p id={`${rateId}-current`} className="settings-field-difference">
              {t('settings.presentation.currentValue', {
                value: formatSampleRate(internal.appliedSampleRate),
              })}
            </p>
          )}
        </div>
      </div>
      {!compact && (deviceChanged || rateChanged) && (
        <p className="settings-notice">
          {t('settings.presentation.nextStart')}
        </p>
      )}
    </section>
  )
}
