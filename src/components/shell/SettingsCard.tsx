import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Volume2, ChevronDown } from 'lucide-react'
import { toast } from 'sonner'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { restart } from '@/lib/session-flow'
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

// §6.5: warn about a missing saved device once per app launch.
let missingDeviceWarned = false

/**
 * The sidebar settings card (§10.2). Rows are organized as a two-column
 * grid — short label on the left, control on the right — inside a white
 * card that matches the selected-project card. Mode/device/target changes
 * restart the session (§8.3); the volume applies live (§6.4).
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

  // §6.5: enumerate CoreAudio outputs; fall back to system default with a
  // notice when the saved device has disappeared.
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

  const handleModeChange = (mode: string) => {
    useSessionStore.getState().setAudioMode(mode)
    if (running) void restart()
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
    // §8.3: device changes restart the session (only internal uses scsynth).
    if (running && audioMode === 'internal') void restart()
  }

  const commitOscTarget = () => {
    if (!oscTargetValid || !currentProject) return
    void saveOscTarget(currentProject.manifest.id, oscTargetInput)
    // §8.3: target changes restart a running external session.
    if (running && audioMode === 'external') void restart()
  }

  const selectClass =
    'h-6 w-full appearance-none rounded-md bg-[#e5e5e5] pl-2 pr-6 text-[12px] text-black/80 outline-none disabled:opacity-40'

  return (
    <div
      data-testid="settings-card"
      className="flex w-full flex-col gap-2.5 rounded-xl bg-[#f5f5f5] p-3.5 text-[13px] shadow-sm"
    >
      {/* OSC target (§6.6): prefilled default, editable for external mode */}
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-black/50">OSC</span>
        <input
          aria-label={t('sidebar.oscTarget')}
          value={oscTargetInput}
          disabled={!projectLoaded || audioMode !== 'external'}
          onChange={e =>
            useSessionStore.getState().setOscTargetInput(e.target.value)
          }
          onBlur={commitOscTarget}
          onKeyDown={e => {
            if (e.key === 'Enter') commitOscTarget()
          }}
          className={cn(
            'h-6 w-full rounded-full bg-[#e5e5e5] px-2.5 text-center font-mono text-[11px] text-black/80 outline-none disabled:opacity-40',
            audioMode === 'external' &&
              !oscTargetValid &&
              'ring-2 ring-red-500/60'
          )}
        />
      </div>

      {/* Audio mode */}
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-black/50">Mode</span>
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
            className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-black/50"
          />
        </div>
      </div>

      <hr className="border-black/10" />

      {/* Master volume (§6.4: internal only, dB-linear, 80% ≈ -6 dB) */}
      <div className="flex items-center gap-2">
        <Volume2 size={14} className="shrink-0 text-black/50" />
        <input
          type="range"
          aria-label={t('sidebar.volume')}
          min={0}
          max={100}
          value={Math.round(volume)}
          disabled={!volumeEnabled}
          onChange={e => handleVolumeChange(Number(e.target.value))}
          className="h-6 w-full accent-[#0088ff] disabled:opacity-40"
        />
        <span className="w-8 shrink-0 text-end text-[11px] tabular-nums text-black/50">
          {Math.round(volume)}
        </span>
      </div>

      {/* Output device (§6.5): app-local preference, restart to apply */}
      <div className="flex items-center gap-2">
        <span className="w-14 shrink-0 text-black/50">Device</span>
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
            className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-black/50"
          />
        </div>
      </div>

      {/* LAN address (not covered by Figma; §7: explicit choice required) */}
      {lanAddresses.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="w-14 shrink-0 text-black/50">LAN</span>
          <div className="relative flex-1">
            <select
              aria-label={t('session.lanAddress')}
              value={lanIp ?? ''}
              onChange={e =>
                useSessionStore.getState().setLanIp(e.target.value)
              }
              className={selectClass}
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
              className="pointer-events-none absolute right-1.5 top-1/2 -translate-y-1/2 text-black/50"
            />
          </div>
        </div>
      )}
    </div>
  )
}
