import { useTranslation } from 'react-i18next'
import { Volume2, VolumeX } from 'lucide-react'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import i18n from '@/i18n/config'
import { notifications } from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { useProjectStore } from '@/store/project-store'
import type { AudioMode } from '@/lib/tauri-bindings'
import { chooseLanAddress, refreshLanAddresses } from '@/lib/lan-settings'
import { isSessionLive, useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import {
  isValidOscTarget,
  ROOM_GROUPS,
  updateOscTarget,
  updatePreferences,
} from '@/lib/preferences'
import { httpsCompatBlocked } from '@/lib/session-flow'
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

const MODE_LABEL_KEYS = {
  internal: 'sidebar.audioMode.internal',
  external: 'sidebar.audioMode.external',
  none: 'sidebar.audioMode.none',
} as const

/**
 * Sidebar settings card (§10.2), rendered as the body of the card whose
 * footer is the session action button.
 *
 * Audio mode and network precede the live gain, matching the performance
 * prototype. LAN edits share the Node section and its global next-start
 * choice; every dropdown aligns values at the end.
 * Deferred audio/OSC changes still apply through the single footer action;
 * gain continues to act immediately on the running master synth.
 *
 * OSC target is hidden unless the selected mode is "external" (§6.6).
 *
 * #58: the card carries only per-performance rows now. The output device
 * moved to the settings Audio section; the LAN selection stays global
 * and is editable both here and in the Node section; the Room dropdown joined for works that declare telematic
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
  onSettingCommitted?: () => void
}

export function SettingsCard({
  onPopupOpenChange,
  onSettingCommitted,
}: SettingsCardProps) {
  const { t } = useTranslation()
  const currentProject = useProjectStore(state => state.currentProject)
  const sessionStatus = useSessionStore(state => state.sessionStatus)
  const sessionProjectPath = useSessionStore(state => state.sessionProjectPath)
  const audioMode = useSessionStore(state => state.audioMode)
  const oscTargetInput = useSessionStore(state => state.oscTargetInput)
  const lanIp = useSessionStore(state => state.lanIp)
  const lanAddresses = useSessionStore(state => state.lanAddresses)
  const hubRooms = useSettingsStore(state => state.hubRooms)
  // #140: the entry switch + the running session's entry state.
  const httpsEnabledSetting = useSettingsStore(
    state => state.httpsEnabledSetting
  )
  const httpsEntry = useSessionStore(state => state.httpsEntry)

  // v1.2.3 (#39/T4): the settings rows follow the SELECTION. While a
  // different card is selected over a live session, the deferred rows hold
  // that card's pending start config (seeded by its preflight); the volume
  // row belongs to the RUNNING session and waits (adjusting it means going
  // back to the running card — the persistent mini-control is future work).
  // NB: this is `!live || match` — NOT `!selectionIsRunningCard()` (that
  // would also enable the row while a different card runs).
  const selectionOnRunningCard =
    !isSessionLive(sessionStatus) || currentProject?.path === sessionProjectPath

  const lanOptions =
    lanIp !== null && !lanAddresses.includes(lanIp)
      ? [lanIp, ...lanAddresses]
      : lanAddresses

  const modes = currentProject?.manifest.audio.supportedModes ?? []
  const projectLoaded = currentProject !== null
  const volume = useSessionStore(state => state.volume)
  const muted = useSessionStore(state => state.muted)
  const oscTargetValid = isValidOscTarget(oscTargetInput)

  // §3.3: outputChannels defaults to 2 when the manifest omits it.
  const projectChannels = currentProject?.manifest.audio.outputChannels ?? 2

  // #140: the entry row shows the RUNNING session's entry (never the
  // selection's — a roaming card has no entry); the compat notice shows
  // when the switch is on, the SELECTED project is undeclared AND
  // declares `needsHttps: true` — works without the declaration (all
  // legacy projects) perform over plain HTTP silently, no nagging.
  const entryRowVisible =
    selectionOnRunningCard &&
    isSessionLive(sessionStatus) &&
    httpsEntry.status !== 'off'
  const entryCompatNotice =
    currentProject !== null &&
    httpsCompatBlocked(
      currentProject.manifest.scoreServer.supportsPerformerUrl,
      httpsEnabledSetting,
      currentProject.manifest.scoreServer.needsHttps
    )

  const copyEntryUrl = async (url: string) => {
    try {
      await writeText(url)
      notifications.success(i18n.t('menu.addressCopied', { url }))
    } catch (error) {
      logger.warn('Failed to copy the entry URL', { error, url })
    }
  }

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
  const labelClass = 'w-20 shrink-0 text-[11px] text-(--pnds-text)/65'
  // Values are data, not chrome: full text strength. Greying them is what
  // reads as "disabled", so only the disabled state may do it.
  const fieldClass =
    'font-manrope h-7 bg-(--pnds-pill) text-[12px] text-(--pnds-text) outline-none transition-colors hover:bg-(--pnds-pill-hover) disabled:text-(--pnds-text)/30 disabled:hover:bg-(--pnds-pill)'
  const selectClass = `${fieldClass} pnds-focus-ring data-[size=sm]:h-7 w-full justify-end rounded-lg ps-2.5 pe-2 text-end [&_[data-slot=select-value]]:ms-auto [&_[data-slot=select-value]]:min-w-0 [&_[data-slot=select-value]]:justify-end`

  return (
    <div
      data-testid="settings-card"
      className="flex flex-col gap-1.5 px-3.5 py-2.5"
    >
      {/* #140: compat notice — the switch is on but the selected
          project has not declared adaptation; its starts run over plain
          HTTP (the start dialog asks for the explicit choice). */}
      {entryCompatNotice && (
        <p
          className="text-(--pnds-danger) text-[11px] leading-snug"
          data-testid="entry-compat-notice"
        >
          {t('sidebar.entryCompat')}
        </p>
      )}

      {/* Audio mode (§6.1): Radix Select like the device row. */}
      <div className="flex items-center gap-2">
        <span className={labelClass}>{t('session.audioMode')}</span>
        <div className="relative flex-1">
          <Select
            value={audioMode}
            onValueChange={value => {
              handleModeChange(value)
              onSettingCommitted?.()
            }}
            onOpenChange={open => onPopupOpenChange?.(open)}
            disabled={!projectLoaded}
          >
            <SelectTrigger
              size="sm"
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
                  {t(MODE_LABEL_KEYS[mode])}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <div
        role="group"
        aria-label={t('sidebar.localNetwork')}
        className="flex items-center gap-2"
      >
        <span className={labelClass}>{t('sidebar.localNetwork')}</span>
        <div className="min-w-0 flex-1">
          <Select
            value={lanIp ?? ''}
            onValueChange={value => {
              chooseLanAddress(value)
              onSettingCommitted?.()
            }}
            dir={i18n.dir() === 'rtl' ? 'rtl' : 'ltr'}
            onOpenChange={open => {
              onPopupOpenChange?.(open)
              if (open) refreshLanAddresses()
            }}
          >
            <SelectTrigger
              size="sm"
              aria-label={t('sidebar.localNetwork')}
              title={t('settings.nodeHint')}
              className={cn(
                selectClass,
                'border-0 shadow-none focus-visible:ring-0'
              )}
            >
              <SelectValue>
                <bdi dir="ltr">{lanIp ?? t('session.lanAddressHint')}</bdi>
              </SelectValue>
            </SelectTrigger>
            <SelectContent side="top">
              {lanOptions.length === 0 && (
                <SelectItem value="__placeholder__" disabled>
                  {t('session.lanAddressHint')}
                </SelectItem>
              )}
              {lanOptions.map(ip => (
                <SelectItem key={ip} value={ip}>
                  <bdi dir="ltr">{ip}</bdi>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      {/* #140: the running session's trusted-HTTPS entry — status dot +
          the fixed URL (click to copy; same string the QR encodes and
          the Window menu copies). Runtime entry faults report here
          without disturbing the session itself. */}
      {entryRowVisible && (
        <div
          className="flex items-center gap-2"
          data-testid="session-entry-row"
        >
          <span className={labelClass}>{t('sidebar.entry')}</span>
          <span
            data-testid="session-entry-status"
            className={cn(
              'shrink-0 text-[11px]',
              httpsEntry.status === 'ready' && 'text-(--pnds-accent-text)',
              httpsEntry.status === 'preparing' && 'text-(--pnds-text)/60',
              httpsEntry.status === 'error' && 'text-(--pnds-danger)'
            )}
          >
            {t(`sidebar.entryStatus.${httpsEntry.status}`)}
          </span>
          {httpsEntry.url && (
            <button
              type="button"
              onClick={() => {
                const url = httpsEntry.url
                if (url) void copyEntryUrl(url)
              }}
              title={httpsEntry.url}
              dir="ltr"
              className="pnds-focus-ring font-manrope truncate text-end text-[11px] text-(--pnds-text)/70 underline-offset-2 hover:underline"
            >
              {httpsEntry.url.replace(/^https:\/\//, '')}
            </button>
          )}
        </div>
      )}
      {/* #141: the fault carries its recovery instruction — an explicit
          restart of THIS performance. Never a hot recovery, never a
          silent HTTP-QR fallback; the URL above stays the entry's
          origin through the fault. */}
      {httpsEntry.status === 'error' && entryRowVisible && httpsEntry.error && (
        <>
          <p
            className="text-(--pnds-danger) ps-[88px] text-[11px] leading-snug"
            data-testid="session-entry-error"
          >
            {httpsEntry.error}
          </p>
          <p
            className="text-(--pnds-text)/60 ps-[88px] text-[11px] leading-snug"
            data-testid="session-entry-recovery"
          >
            {t('sidebar.entryRecovery')}
          </p>
        </>
      )}

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
              onValueChange={value => {
                handleRoomChange(value)
                onSettingCommitted?.()
              }}
              onOpenChange={open => onPopupOpenChange?.(open)}
            >
              <SelectTrigger
                size="sm"
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
    </div>
  )
}
