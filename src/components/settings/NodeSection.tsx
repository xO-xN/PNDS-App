import { PublicEntryDetails } from '@/components/shell/PublicEntryDetails'
import { SettingsCard } from '@/components/shell/SettingsCard'
import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeNodeName, updatePreferences } from '@/lib/preferences'
import { chooseLanAddress, refreshLanAddresses } from '@/lib/lan-settings'
import { useLanInterfaceKinds } from '@/hooks/use-lan-interface-kinds'
import { LanAddressLabel } from './LanAddressLabel'
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
 * lock. Fields commit on blur. A node rename keeps the existing identity
 * until its replacement is persisted.
 */
export function NodeSection({
  section,
  compact = false,
  pending = false,
}: {
  section: SettingsSection
  /** The quick panel keeps the node name; Hub credentials live in full settings. */
  compact?: boolean
  pending?: boolean
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
  const [nodeNameDraft, setNodeNameDraft] = useState<string | null>(null)
  const [savingNodeName, setSavingNodeName] = useState(false)
  const [nodeNameError, setNodeNameError] = useState<'invalid' | 'save' | null>(
    null
  )
  const prefix = compact ? 'network' : 'settings'
  const snapshot = useSessionStore(state => state.latestSnapshot)
  const status = useSessionStore(state => state.sessionStatus)
  const applied =
    status === 'ready' && snapshot?.status === 'ready' ? snapshot : null
  const lanDifference =
    applied?.lanIp && applied.lanIp !== lanIp ? applied.lanIp : null
  const rowClass = 'settings-field'
  const labelClass = 'settings-field-label'
  const inputClass = 'settings-field-input'

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
  const interfaces = useLanInterfaceKinds(lanOptions)

  const commitHubConfig = () => {
    const { hubUrlSetting: hubUrl, hubTokenSetting: hubToken } =
      useSettingsStore.getState()
    void updatePreferences({
      hubUrl: hubUrl.trim() === '' ? null : hubUrl,
      hubToken: hubToken.trim() === '' ? null : hubToken,
    })
  }

  const commitNodeName = () => {
    if (nodeNameDraft === null || savingNodeName) return
    const name = normalizeNodeName(nodeNameDraft)
    if (!name) {
      setNodeNameError('invalid')
      return
    }
    setNodeNameError(null)
    if (name === nodeNameSetting) {
      setNodeNameDraft(null)
      return
    }
    setSavingNodeName(true)
    void updatePreferences({ nodeName: name }).then(saved => {
      setSavingNodeName(false)
      if (saved) {
        useSettingsStore.getState().setNodeNameSetting(name)
        setNodeNameDraft(null)
      } else setNodeNameError('save')
    })
  }

  return (
    <section
      id={compact ? undefined : `settings-section-${section}`}
      aria-labelledby={compact ? undefined : `settings-${section}-title`}
      aria-label={compact ? t('settings.node') : undefined}
      className={
        compact
          ? 'settings-section settings-section-compact settings-node-compact'
          : 'settings-section'
      }
    >
      {!compact && (
        <SectionTitle id={`settings-${section}-title`}>
          {t('settings.node')}
        </SectionTitle>
      )}
      {!compact && <PublicEntryDetails />}
      {!compact && (
        <SettingsCard
          quickNetwork
          networkFields="project"
          showAudioMode={false}
          showGain={false}
        />
      )}
      {/* LAN address (moved from the sidebar settings card): the machine's
          network situation, not a per-performance decision. Seeded at
          preflight, refreshed on panel/menu open; read at start (PNDS_HOST_IP). */}
      {!compact && (
        <div className={rowClass}>
          <Label htmlFor="settings-lan-address" className={labelClass}>
            {t('session.lanAddress')}
          </Label>
          <div className="settings-field-control">
            <Select
              value={lanIp ?? ''}
              disabled={lanOptions.length === 0}
              onOpenChange={open => {
                if (open) {
                  refreshLanAddresses()
                  interfaces.refresh()
                }
              }}
              onValueChange={value => {
                setModified(true)
                chooseLanAddress(value)
              }}
            >
              <SelectTrigger
                id="settings-lan-address"
                aria-description={
                  lanIp
                    ? t(
                        `settings.interfaceType.${interfaces.kinds[lanIp] ?? 'unknown'}`
                      )
                    : undefined
                }
              >
                <SelectValue placeholder={t('session.lanAddressHint')}>
                  {lanIp && (
                    <LanAddressLabel
                      address={lanIp}
                      kind={interfaces.kinds[lanIp]}
                    />
                  )}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                {lanOptions.map(ip => (
                  <SelectItem
                    key={ip}
                    value={ip}
                    aria-description={t(
                      `settings.interfaceType.${interfaces.kinds[ip] ?? 'unknown'}`
                    )}
                  >
                    <LanAddressLabel address={ip} kind={interfaces.kinds[ip]} />
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {lanDifference && (
              <p className="settings-field-difference">
                {t('settings.presentation.currentValue', {
                  value: lanDifference,
                })}
              </p>
            )}
          </div>
        </div>
      )}
      <div className={rowClass}>
        <Label htmlFor={`${prefix}-node-name`} className={labelClass}>
          {t('settings.nodeName')}
        </Label>
        <div className="settings-field-control">
          <Input
            id={`${prefix}-node-name`}
            value={nodeNameDraft ?? nodeNameSetting}
            placeholder={t('settings.nodeNamePlaceholder', {
              hostname: hostnameHint || 'hostname',
            })}
            autoComplete="off"
            spellCheck={false}
            disabled={savingNodeName}
            aria-invalid={nodeNameError === 'invalid'}
            aria-describedby={
              nodeNameError ? `${prefix}-node-name-error` : undefined
            }
            onChange={event => {
              setNodeNameDraft(event.target.value)
              setNodeNameError(null)
              setModified(true)
            }}
            onBlur={commitNodeName}
            className={inputClass}
          />
          {nodeNameError && (
            <p
              id={`${prefix}-node-name-error`}
              className="settings-field-description text-(--pnds-danger)"
              role="alert"
            >
              {t(
                nodeNameError === 'invalid'
                  ? 'participation.nodeSetup.invalidName'
                  : 'participation.ui.nameSaveFailed'
              )}
            </p>
          )}
        </div>
      </div>
      {!compact && (
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
            onBlur={commitHubConfig}
            className={inputClass}
          />
        </div>
      )}
      {!compact && (
        <div className={rowClass}>
          <Label htmlFor="settings-hub-token" className={labelClass}>
            {t('settings.hubToken')}
          </Label>
          <div className="settings-field-control">
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
                useSettingsStore
                  .getState()
                  .setHubTokenSetting(event.target.value)
                setModified(true)
              }}
              onBlur={commitHubConfig}
              className={inputClass}
            />
            <p className="settings-field-description">
              {t('settings.presentation.tokenHint')}
            </p>
          </div>
        </div>
      )}
      {(modified || pending || (!compact && lanDifference)) && (
        <p className="settings-notice" data-testid="node-hint">
          {t('settings.nodeHint')}
        </p>
      )}
    </section>
  )
}
