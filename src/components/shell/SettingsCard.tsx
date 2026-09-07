import { useTranslation } from 'react-i18next'
import { Volume2, VolumeX } from 'lucide-react'
import { useProjectStore } from '@/store/project-store'
import type { AudioMode } from '@/lib/tauri-bindings'
import { isSessionLive, useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import {
  isValidOscTarget,
  ROOM_GROUPS,
  updateOscTarget,
  updatePreferences,
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
 *
 * #58: the card carries only per-performance rows now. The output device
 * moved to the settings Audio section and the LAN address to the Node
 * section; the Room dropdown joined for works that declare telematic
 * capability — the App-global group number (1–3) the hub room derives
 * from (`{manifest.id}_{group}`). The dropdown never resets (crash
 * recovery must land back in the same group's room, ADR-0004), shows only
 * the number, and a change applies at the next start without flagging
 * Change: the running session's room was fixed at its spawn.
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
  const oscTargetInput = useSessionStore(state => state.oscTargetInput)
  const hubRooms = useSettingsStore(state => state.hubRooms)

  // v1.2.3 (#39/T4): the settings rows follow the SELECTION. While a
  // different card is selected over a live session, the deferred rows hold
  // that card's pending start config (seeded by its preflight); the volume
  // row belongs to the RUNNING session and waits (adjusting it means going
  // back to the running card — the persistent mini-control is future work).
  // NB: this is `!live || match` — NOT `!selectionIsRunningCard()` (that
  // would also enable the row while a different card runs).
  const selectionOnRunningCard =
    !isSessionLive(sessionStatus) || currentProject?.path === sessionProjectPath

  const modes = currentProject?.manifest.audio.supportedModes ?? []
  const projectLoaded = currentProject !== null
  const volume = useSessionStore(state => state.volume)
  const muted = useSessionStore(state => state.muted)
  const oscTargetValid = isValidOscTarget(oscTargetInput)

  // §3.3: outputChannels defaults to 2 when the manifest omits it.
  const projectChannels = currentProject?.manifest.audio.outputChannels ?? 2

  // #58: Room appears only for works that declare telematic capability.
  // The group reads this project's persisted choice — absent = 1 — and a
  // change writes it back per project (never reset, never reset-to-1).
  const telematic = currentProject?.manifest.telematic === true
  const roomGroup = telematic
    ? (hubRooms[currentProject.manifest.id] ?? 1)
    : null

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

  // Radix Select hands back a string; the options below are generated
  // from the manifest's supportedModes, so the value is an AudioMode.
  const handleModeChange = (mode: string) => {
    useSessionStore.getState().setAudioMode(mode as AudioMode)
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

  const commitOscTarget = () => {
    if (!oscTargetValid || !currentProject) return
    void updateOscTarget(currentProject.manifest.id, oscTargetInput)
    flagChange()
  }

  const handleRoomChange = (group: string) => {
    const projectId = currentProject?.manifest.id
    if (!telematic || !projectId) return
    const rooms = {
      ...useSettingsStore.getState().hubRooms,
      [projectId]: Number(group),
    }
    useSettingsStore.getState().setHubRooms(rooms)
    void updatePreferences({ hubRooms: rooms })
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

      {/* #58: Room — the telematic group number. The derived room name is
          deliberately invisible here: the operator coordinates numbers,
          the project-side monitor shows the full derived name when
          diagnosing. Applies at the next start; never flags Change. */}
      {telematic && roomGroup !== null && (
        <div className="flex items-center gap-2">
          <span className={labelClass}>{t('sidebar.room')}</span>
          <div className="relative flex-1">
            <Select
              value={String(roomGroup)}
              onValueChange={handleRoomChange}
              onOpenChange={open => onPopupOpenChange?.(open)}
            >
              <SelectTrigger
                aria-label={t('sidebar.room')}
                className={cn(
                  selectClass,
                  'border-0 shadow-none focus-visible:ring-0',
                  'font-manrope'
                )}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent side="top">
                {ROOM_GROUPS.map(group => (
                  <SelectItem key={group} value={String(group)}>
                    {group}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </div>
      )}
    </div>
  )
}
