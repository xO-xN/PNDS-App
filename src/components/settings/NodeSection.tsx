import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updatePreferences } from '@/lib/preferences'
import { chooseLanAddress, refreshLanAddresses } from '@/lib/lan-settings'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SettingsSection } from '@/store/settings-store'

import { SectionTitle } from './SectionTitle'

/**
 * #58: the settings Node section — this machine's telematic identity, set
 * once and shared by every project: node name (placeholder hints the
 * hostname), hub address (full URL; the token NEVER rides it) and the
 * token (its own field, masked). The LAN address moved here from the
 * sidebar settings card: all four describe the machine's situation, not
 * a per-performance decision.
 *
 * Everything here applies at the NEXT project start — the running session
 * keeps the environment it was spawned with — so no row needs a live
 * lock. Store updates are optimistic; persistence commits on blur (one
 * save per finished edit, not per keystroke).
 */
export function NodeSection({
  section,
  compact = false,
}: {
  section: SettingsSection
  /** Network popover shares the identity inputs; token and LAN keep their own entries. */
  compact?: boolean
}) {
  const { t } = useTranslation()
  const nodeNameSetting = useSettingsStore(state => state.nodeNameSetting)
  const hubUrlSetting = useSettingsStore(state => state.hubUrlSetting)
  const hubTokenSetting = useSettingsStore(state => state.hubTokenSetting)
  const hostnameHint = useSettingsStore(state => state.hostnameHint)
  const lanIp = useSessionStore(state => state.lanIp)
  const lanAddresses = useSessionStore(state => state.lanAddresses)
  // The next-start note stays out of the way until it has something to
  // say: it appears once any row here is touched and stays for the rest
  // of the visit (closing the dialog unmounts the section, resetting it).
  const [modified, setModified] = useState(false)
  const prefix = compact ? 'network' : 'settings'
  const rowClass = compact
    ? 'flex items-center gap-2'
    : 'flex items-center justify-between gap-4'
  const labelClass = compact
    ? 'w-20 shrink-0 text-[11px] font-normal text-(--pnds-text-secondary)'
    : 'shrink-0'
  const inputClass = compact
    ? 'font-manrope h-7 min-w-0 flex-1 rounded-lg border-0 bg-(--pnds-pill) px-2.5 text-end text-[12px] shadow-none hover:bg-(--pnds-pill-hover)'
    : 'w-56'

  // The LAN list is seeded by preflight — a first App launch with no
  // project opened yet has none, leaving the row stuck on the "Select…"
  // placeholder (user report). Refresh on panel open and whenever the
  // App's address menu opens, including a reopen without a focus change.
  useEffect(() => {
    if (!compact) refreshLanAddresses()
  }, [compact])

  // The union covers the instant between the boot's persisted seed and
  // the first refresh (the store's refresh normalization replaces a
  // gone address) — the selected address stays visible rather than
  // blanking the row mid-read.
  const lanOptions =
    lanIp !== null && !lanAddresses.includes(lanIp)
      ? [lanIp, ...lanAddresses]
      : lanAddresses

  const commitNodeConfig = () => {
    const {
      nodeNameSetting: nodeName,
      hubUrlSetting: hubUrl,
      hubTokenSetting: hubToken,
    } = useSettingsStore.getState()
    void updatePreferences({
      nodeName: nodeName.trim() === '' ? null : nodeName,
      hubUrl: hubUrl.trim() === '' ? null : hubUrl,
      hubToken: hubToken.trim() === '' ? null : hubToken,
    })
  }

  return (
    <section
      id={compact ? undefined : `settings-section-${section}`}
      aria-labelledby={compact ? undefined : `settings-${section}-title`}
      aria-label={compact ? t('settings.node') : undefined}
      className={
        compact
          ? 'flex flex-col gap-1.5 px-3.5 pb-2.5'
          : 'flex flex-col gap-3 py-4'
      }
    >
      {!compact && (
        <SectionTitle id={`settings-${section}-title`}>
          {t('settings.node')}
        </SectionTitle>
      )}
      <div className={rowClass}>
        <Label htmlFor={`${prefix}-node-name`} className={labelClass}>
          {t('settings.nodeName')}
        </Label>
        <Input
          id={`${prefix}-node-name`}
          value={nodeNameSetting}
          placeholder={t('settings.nodeNamePlaceholder', {
            hostname: hostnameHint || 'hostname',
          })}
          autoComplete="off"
          spellCheck={false}
          onChange={event => {
            useSettingsStore.getState().setNodeNameSetting(event.target.value)
            setModified(true)
          }}
          onBlur={commitNodeConfig}
          className={inputClass}
        />
      </div>
      <div className={rowClass}>
        <Label htmlFor={`${prefix}-hub-url`} className={labelClass}>
          {t('settings.hubUrl')}
        </Label>
        <Input
          id={`${prefix}-hub-url`}
          value={hubUrlSetting}
          placeholder="wss://hub.example.org:3000"
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          onChange={event => {
            useSettingsStore.getState().setHubUrlSetting(event.target.value)
            setModified(true)
          }}
          onBlur={commitNodeConfig}
          className={inputClass}
        />
      </div>
      {!compact && (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="settings-hub-token" className="shrink-0">
            {t('settings.hubToken')}
          </Label>
          {/* Masked display: the token is stored as its own field and only
            ever travels as the injected PNDS_HUB_TOKEN variable — never in
            the URL, never on screen. */}
          <Input
            id="settings-hub-token"
            type="password"
            value={hubTokenSetting}
            placeholder={t('settings.hubTokenPlaceholder')}
            autoComplete="off"
            spellCheck={false}
            dir="ltr"
            onChange={event => {
              useSettingsStore.getState().setHubTokenSetting(event.target.value)
              setModified(true)
            }}
            onBlur={commitNodeConfig}
            className="w-56"
          />
        </div>
      )}
      {/* LAN address (moved from the sidebar settings card): the machine's
          network situation, not a per-performance decision. Seeded at
          preflight, refreshed on panel/menu open; read at start (PNDS_HOST_IP). */}
      {!compact && (
        <div className="flex items-center justify-between gap-4">
          <Label htmlFor="settings-lan-address" className="shrink-0">
            {t('session.lanAddress')}
          </Label>
          <Select
            value={lanIp ?? ''}
            disabled={lanOptions.length === 0}
            onOpenChange={open => {
              if (open) refreshLanAddresses()
            }}
            onValueChange={value => {
              setModified(true)
              chooseLanAddress(value)
            }}
          >
            <SelectTrigger id="settings-lan-address">
              <SelectValue placeholder={t('session.lanAddressHint')} />
            </SelectTrigger>
            <SelectContent>
              {lanOptions.map(ip => (
                <SelectItem key={ip} value={ip}>
                  {ip}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
      {modified && (
        <p className="text-muted-foreground text-xs" data-testid="node-hint">
          {t('settings.nodeHint')}
        </p>
      )}
    </section>
  )
}
