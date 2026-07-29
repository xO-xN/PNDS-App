import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Volume2, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import {
  isValidOscTarget,
  saveOscTarget,
  saveOutputDevice,
  SYSTEM_DEFAULT_DEVICE,
} from '@/lib/audio-prefs'
import { cn } from '@/lib/utils'

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
export function SettingsCard() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const audioMode = useSessionStore(state => state.audioMode)
  const lanIp = useSessionStore(state => state.lanIp)
  const lanAddresses = useSessionStore(state => state.lanAddresses)
  const outputDevice = useSessionStore(state => state.outputDevice)
  const oscTargetInput = useSessionStore(state => state.oscTargetInput)
  const [devices, setDevices] = useState<string[]>([])

  const modes = currentProject?.manifest.audio.supportedModes ?? []
  const projectLoaded = currentProject !== null
  const running = sessionStatus !== 'idle'
  const volumeEnabled = sessionStatus === 'ready' && audioMode === 'internal'
  const volume = useSessionStore(state => state.volume)
  const oscTargetValid = isValidOscTarget(oscTargetInput)

  useEffect(() => {
    void commands.listOutputDevices().then(result => {
      if (result.status !== 'ok') {
        logger.warn('Failed to list output devices', { error: result.error })
        return
      }
      setDevices(result.data.devices)
      const saved = useSessionStore.getState().outputDevice
      if (
        saved !== SYSTEM_DEFAULT_DEVICE &&
        !result.data.devices.includes(saved) &&
        !missingDeviceWarned
      ) {
        missingDeviceWarned = true
        useSessionStore.getState().setOutputDevice(SYSTEM_DEFAULT_DEVICE)
        void saveOutputDevice(null)
        toast.info(
          `Saved output device "${saved}" is not available; using the system default.`
        )
      }
    })
  }, [])

  const flagChange = () => {
    if (running) useSessionStore.getState().setPendingChanges(true)
  }

  const handleModeChange = (mode: string) => {
    useSessionStore.getState().setAudioMode(mode)
    flagChange()
  }

  const handleVolumeChange = (percent: number) => {
    useSessionStore.getState().setVolume(percent)
    void commands.setMasterVolume(percent).then(result => {
      if (result.status === 'error') {
        logger.warn('setMasterVolume failed', { error: result.error })
      }
    })
  }

  const handleDeviceChange = (device: string) => {
    useSessionStore.getState().setOutputDevice(device)
    void saveOutputDevice(device === SYSTEM_DEFAULT_DEVICE ? null : device)
    flagChange()
  }

  const commitOscTarget = () => {
    if (!oscTargetValid || !currentProject) return
    void saveOscTarget(currentProject.manifest.id, oscTargetInput)
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

  return (
    <div
      data-testid="settings-card"
      className="flex flex-col gap-2 px-3.5 pb-3.5 pt-3"
    >
      {/* Master volume (§6.4: internal only, dB-linear, 80% ≈ -6 dB).
          Live — applied on drag, never deferred. */}
      <div className="flex items-center gap-2">
        <span
          className={cn(
            labelClass,
            'flex items-center',
            !volumeEnabled && 'opacity-45'
          )}
        >
          <Volume2 size={14} />
        </span>
        <input
          type="range"
          aria-label={t('sidebar.volume')}
          min={0}
          max={100}
          value={Math.round(volume)}
          disabled={!volumeEnabled}
          onChange={e => handleVolumeChange(Number(e.target.value))}
          className="h-7 w-full accent-(--pnds-accent) disabled:opacity-35"
        />
        <span
          className={cn(
            'font-manrope w-7 shrink-0 text-end text-[11px] tabular-nums',
            volumeEnabled ? 'text-(--pnds-text)/70' : 'text-(--pnds-text)/30'
          )}
        >
          {Math.round(volume)}
        </span>
      </div>

      {/* Everything below is deferred until the footer button (§8.3). */}
      <hr className="my-0.5 border-(--pnds-text)/10" />

      {/* Audio mode */}
      <div className="flex items-center gap-2">
        <span className={labelClass}>Mode</span>
        <div className="relative flex-1">
          <select
            aria-label={t('session.audioMode')}
            value={audioMode}
            disabled={!projectLoaded}
            onChange={e => handleModeChange(e.target.value)}
            className={selectClass}
          >
            {modes.length === 0 && <option value="">—</option>}
            {modes.map(mode => (
              <option key={mode} value={mode}>
                {MODE_LABELS[mode] ?? mode}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-(--pnds-text)/40"
          />
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

      {/* Output device (§6.5): preference, deferred until Change */}
      <div className="flex items-center gap-2">
        <span className={labelClass}>Device</span>
        <div className="relative flex-1">
          <select
            aria-label={t('sidebar.outputDevice')}
            value={outputDevice}
            onChange={e => handleDeviceChange(e.target.value)}
            className={selectClass}
          >
            <option value={SYSTEM_DEFAULT_DEVICE}>
              {t('sidebar.systemDefault')}
            </option>
            {devices.map(device => (
              <option key={device} value={device}>
                {device}
              </option>
            ))}
          </select>
          <ChevronDown
            size={12}
            className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-(--pnds-text)/40"
          />
        </div>
      </div>

      {/* LAN address (replaces Figma — §7: explicit choice required) */}
      {lanAddresses.length > 1 && (
        <div className="flex items-center gap-2">
          <span className={labelClass}>LAN</span>
          <div className="relative flex-1">
            <select
              aria-label={t('session.lanAddress')}
              value={lanIp ?? ''}
              onChange={e => {
                useSessionStore.getState().setLanIp(e.target.value)
                flagChange()
              }}
              className={cn(selectClass, 'font-manrope')}
            >
              <option value="" disabled>
                {t('session.lanAddressHint')}
              </option>
              {lanAddresses.map(ip => (
                <option key={ip} value={ip}>
                  {ip}
                </option>
              ))}
            </select>
            <ChevronDown
              size={12}
              className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-(--pnds-text)/40"
            />
          </div>
        </div>
      )}
    </div>
  )
}
