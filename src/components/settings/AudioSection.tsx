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
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
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
 * NEXT project start, locked while a session is live (no mid-session
 * change path). The list enumerates at the effective sample rate; each
 * entry shows its channel count there, channel-poor entries stay
 * selectable with the red `Nch → Hch` loss marker (§7.6).
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
export function AudioSection({ section }: { section: SettingsSection }) {
  const { t } = useTranslation()
  const sampleRateSetting = useSettingsStore(state => state.sampleRateSetting)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const outputDevice = useSessionStore(state => state.outputDevice)
  const projectChannels =
    useProjectStore(
      state => state.currentProject?.manifest.audio.outputChannels
    ) ?? 2
  const [rates, setRates] = useState<number[] | null>(null)
  const [devices, setDevices] = useState<
    { name: string; isDefault: boolean; maxOutputChannels: number }[]
  >([])

  // A session "runs" in the same states the Ports section treats as live;
  // 'error' is not a running session — a boot failure at one rate must not
  // lock the user out of picking another.
  const running =
    sessionStatus === 'starting' ||
    sessionStatus === 'ready' ||
    sessionStatus === 'stopping'

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
  // above owns the rate, this list follows it. Re-queries when the rate
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
        toast.info(t('settings.deviceMissingToast', { device: saved }))
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
  const selectedDefaultChannels = devices.find(
    device => device.isDefault
  )?.maxOutputChannels
  const selectedChannels =
    outputDevice === SYSTEM_DEFAULT_DEVICE
      ? selectedDefaultChannels
      : devices.find(device => device.name === outputDevice)?.maxOutputChannels
  const insufficient =
    selectedChannels !== undefined && selectedChannels < projectChannels

  return (
    <section
      id={`settings-section-${section}`}
      aria-labelledby={`settings-${section}-title`}
      className="flex flex-col gap-3 py-4"
    >
      <SectionTitle id={`settings-${section}-title`}>
        {t('settings.audio')}
      </SectionTitle>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-sample-rate">{t('settings.sampleRate')}</Label>
        <NativeSelect
          id="settings-sample-rate"
          value={sampleRateSetting}
          disabled={running}
          onChange={event => {
            const rate = Number(event.target.value)
            useSettingsStore.getState().setSampleRateSetting(rate)
            void updatePreferences({ sampleRate: rate })
          }}
        >
          {options.map(rate => (
            <NativeSelectOption key={rate} value={rate}>
              {formatSampleRate(rate)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {/* #58: output device (moved from the sidebar settings card) — the
          §7.6 display contract travels intact: channel counts per entry,
          channel-poor entries stay selectable with the red loss text, and
          the closed trigger carries the loss as a small red dot whose
          specifics live in its tooltip/sr-only text. */}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-output-device">
          {t('settings.outputDevice')}
        </Label>
        <Select
          value={outputDevice}
          onValueChange={device => {
            useSessionStore.getState().setOutputDevice(device)
            void updatePreferences({
              outputDevice: device === SYSTEM_DEFAULT_DEVICE ? null : device,
            })
          }}
          disabled={running}
        >
          <SelectTrigger
            id="settings-output-device"
            aria-label={t('settings.outputDevice')}
            className="w-56"
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
          <SelectContent>
            <SelectItem value={SYSTEM_DEFAULT_DEVICE}>
              <span className="flex min-w-0 flex-1 items-center gap-1.5">
                <span className="truncate">{t('sidebar.systemDefault')}</span>
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
              const deviceInsufficient =
                device.maxOutputChannels < projectChannels
              return (
                <SelectItem
                  key={device.name}
                  value={device.name}
                  className={cn(
                    'pr-9',
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
                          : 'text-(--pnds-text)/45'
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
      </div>
      <p
        className="text-muted-foreground text-xs"
        data-testid="sample-rate-hint"
      >
        {running
          ? t('settings.sampleRateLocked')
          : t('settings.sampleRateHint')}
      </p>
    </section>
  )
}
