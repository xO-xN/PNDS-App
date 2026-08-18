import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { commands } from '@/lib/tauri-bindings'
import {
  FALLBACK_SAMPLE_RATES,
  saveSampleRatePreference,
} from '@/lib/audio-prefs'
import { logger } from '@/lib/logger'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import type { SettingsSection } from '@/store/settings-store'

/** 48000 → "48 kHz", 44100 → "44.1 kHz" — compact enough for the row,
 * precise enough for the audio domain. */
function formatSampleRate(rate: number): string {
  return `${rate / 1000} kHz`
}

/**
 * Issue #21: the settings Audio section — the App's global sample rate
 * (the sole audio authority since #20) as an inline select, the same
 * control pattern as the language setting. Rate-only by design: the
 * output device stays in the sidebar settings card.
 *
 * The offered rates are the standard rates supported across all enumerated
 * output devices (the backend dedupes, sorts ascending, and falls back to
 * the fixed standard list on enumeration failure — so this query can only
 * fail at the transport level, which degrades to the same list here).
 *
 * The rate only ever applies at the next project start: while a session
 * is live (starting/ready/stopping) the select is disabled with a hint, so
 * no mid-session change path exists.
 *
 * Query discipline like the Ports section: once on mount (= panel open,
 * Radix unmounts closed dialogs), no polling, and a taken-down panel
 * never applies a stale response.
 */
export function AudioSection({ section }: { section: SettingsSection }) {
  const { t } = useTranslation()
  const sampleRateSetting = useSettingsStore(state => state.sampleRateSetting)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const [rates, setRates] = useState<number[] | null>(null)

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

  // The fallback list covers the wait and the failure; a saved preference
  // the current hardware no longer offers stays visible (and selectable
  // as-is) rather than silently rendering a blank or wrong value.
  const offered = rates ?? FALLBACK_SAMPLE_RATES
  const options = offered.includes(sampleRateSetting)
    ? offered
    : [...offered, sampleRateSetting].sort((a, b) => a - b)

  return (
    <section
      id={`settings-section-${section}`}
      aria-labelledby={`settings-${section}-title`}
      className="flex flex-col gap-3 py-4"
    >
      <h3 id={`settings-${section}-title`} className="text-sm font-semibold">
        {t('settings.audio')}
      </h3>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-sample-rate">{t('settings.sampleRate')}</Label>
        <NativeSelect
          id="settings-sample-rate"
          value={sampleRateSetting}
          disabled={running}
          onChange={event => {
            const rate = Number(event.target.value)
            useSettingsStore.getState().setSampleRateSetting(rate)
            void saveSampleRatePreference(rate)
          }}
        >
          {options.map(rate => (
            <NativeSelectOption key={rate} value={rate}>
              {formatSampleRate(rate)}
            </NativeSelectOption>
          ))}
        </NativeSelect>
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
