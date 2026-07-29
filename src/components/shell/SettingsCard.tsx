import { useTranslation } from 'react-i18next'
import { Volume2, ChevronDown } from 'lucide-react'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { restartSession, startIfReady } from '@/lib/open-project'

const MODE_LABELS: Record<string, string> = {
  internal: 'Internal Synth',
  external: 'External Synth',
  none: 'None',
}

/**
 * The sidebar settings card (§10.2, Figma "PNDS UI Design"): OSC target,
 * audio mode, divider, volume, output device — plus the LAN row, which
 * Figma does not cover and only appears when several interfaces exist.
 *
 * Control availability: mode is selectable whenever a project is loaded;
 * changing it while running restarts the session (§8.3). Volume and device
 * stay disabled until task-4/task-5.
 */
export function SettingsCard() {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const audioMode = useSessionStore(state => state.audioMode)
  const lanIp = useSessionStore(state => state.lanIp)
  const lanAddresses = useSessionStore(state => state.lanAddresses)

  const modes = currentProject?.manifest.audio.supportedModes ?? []
  const projectLoaded = currentProject !== null
  const running = sessionStatus !== 'idle'

  const handleModeChange = (mode: string) => {
    useSessionStore.getState().setAudioMode(mode)
    // §8.3: changing the mode of a live session is a full restart.
    if (running) void restartSession()
  }

  const handleLanChange = (ip: string) => {
    useSessionStore.getState().setLanIp(ip)
    // An address was the last missing piece — start can proceed now (§7).
    void startIfReady()
  }

  return (
    <div
      data-testid="settings-card"
      className="flex w-[213px] flex-col gap-2 rounded-xl border border-black/10 bg-black/5 p-3 text-[13px]"
    >
      {/* OSC target (§6.6): prefilled default, editable for external mode */}
      <div className="flex items-center justify-between gap-2">
        <span className="text-black/80">OSC</span>
        <input
          aria-label={t('sidebar.oscTarget')}
          defaultValue="127.0.0.1:3333"
          disabled={!projectLoaded || audioMode !== 'external'}
          className="w-32 rounded-full bg-[#d9d9d9] px-2.5 py-0.5 text-center text-xs text-black/80 outline-none disabled:opacity-50"
        />
      </div>

      {/* Audio mode */}
      <div className="relative">
        <select
          aria-label={t('session.audioMode')}
          value={audioMode}
          disabled={!projectLoaded}
          onChange={e => handleModeChange(e.target.value)}
          className="w-full appearance-none rounded-md bg-transparent px-1 py-0.5 text-black/80 outline-none disabled:opacity-50"
        >
          {modes.length === 0 && <option value="">—</option>}
          {modes.map(mode => (
            <option key={mode} value={mode}>
              {MODE_LABELS[mode] ?? mode}
            </option>
          ))}
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-black/50"
        />
      </div>

      <hr className="border-black/15" />

      {/* Master volume (task-4) */}
      <div className="flex items-center gap-2">
        <Volume2 size={15} className="shrink-0 text-black/70" />
        <input
          type="range"
          aria-label={t('sidebar.volume')}
          min={0}
          max={100}
          defaultValue={80}
          disabled
          className="w-full accent-[#0088ff] disabled:opacity-50"
        />
      </div>

      {/* Output device (task-5) */}
      <div className="relative">
        <select
          aria-label={t('sidebar.outputDevice')}
          disabled
          className="w-full appearance-none rounded-md bg-transparent px-1 py-0.5 text-black/80 outline-none disabled:opacity-50"
        >
          <option>{t('sidebar.systemDefault')}</option>
        </select>
        <ChevronDown
          size={14}
          className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-black/50"
        />
      </div>

      {/* LAN address (not covered by Figma; §7: explicit choice required) */}
      {lanAddresses.length > 1 && (
        <div className="relative">
          <select
            aria-label={t('session.lanAddress')}
            value={lanIp ?? ''}
            onChange={e => handleLanChange(e.target.value)}
            className="w-full appearance-none rounded-md bg-transparent px-1 py-0.5 text-black/80 outline-none"
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
            size={14}
            className="pointer-events-none absolute right-1 top-1/2 -translate-y-1/2 text-black/50"
          />
        </div>
      )}
    </div>
  )
}
