import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updatePreferences } from '@/lib/preferences'
import { logger } from '@/lib/logger'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { selectionIsRunningCard, useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import type { SettingsSection } from '@/store/settings-store'

import { SectionTitle } from './SectionTitle'

/** Refresh the machine's LAN address list in the session store, applying
 * preflight's auto-pick policy (a yet-unpicked selection takes the first
 * address). Failure keeps the current list — the row degrades to the
 * "Select…" placeholder only when nothing was known before. */
function refreshLanAddresses(): void {
  void commands.listLanAddresses().then(result => {
    if (result.status === 'error') {
      logger.warn('Failed to list LAN addresses', { error: result.error })
      return
    }
    const session = useSessionStore.getState()
    session.setLanAddresses(result.data)
    if (session.lanIp === null && result.data[0]) {
      session.setLanIp(result.data[0])
    }
  })
}

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
export function NodeSection({ section }: { section: SettingsSection }) {
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

  // The LAN list is seeded by preflight — a first App launch with no
  // project opened yet has none, leaving the row stuck on the "Select…"
  // placeholder (user report). Refresh on panel open (Radix unmounts the
  // closed dialog, so mounting == opening) and again whenever the select
  // gains focus — the closest hook a native select offers to "menu
  // opening"; the response lands behind an already-open menu and shows up
  // on its next open.
  useEffect(() => {
    refreshLanAddresses()
  }, [])

  // A refresh can shrink the list past the current selection (the network
  // changed under a running session) — keep the selected address visible
  // rather than blanking the row.
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
      id={`settings-section-${section}`}
      aria-labelledby={`settings-${section}-title`}
      className="flex flex-col gap-3 py-4"
    >
      <SectionTitle id={`settings-${section}-title`}>
        {t('settings.node')}
      </SectionTitle>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-node-name" className="shrink-0">
          {t('settings.nodeName')}
        </Label>
        <Input
          id="settings-node-name"
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
          className="w-56"
        />
      </div>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-hub-url" className="shrink-0">
          {t('settings.hubUrl')}
        </Label>
        <Input
          id="settings-hub-url"
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
          className="w-56"
        />
      </div>
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
      {/* LAN address (moved from the sidebar settings card): the machine's
          network situation, not a per-performance decision. Seeded at
          preflight, refreshed on panel open and select focus; read at
          start (PNDS_HOST_IP). No width class here: NativeSelect routes
          className to the absolutely-positioned inner select while the
          wrapper keeps the sizer's snug width — a fixed width desyncs
          the two and the select overflows the panel. */}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-lan-address" className="shrink-0">
          {t('session.lanAddress')}
        </Label>
        <NativeSelect
          id="settings-lan-address"
          value={lanIp ?? ''}
          disabled={lanOptions.length === 0}
          onFocus={refreshLanAddresses}
          onChange={event => {
            setModified(true)
            useSessionStore.getState().setLanIp(event.target.value)
            // Migration parity with the old sidebar row: a LAN change on
            // the running card flags Change — restart re-spawns with the
            // new PNDS_HOST_IP. On any other selection it is
            // pre-configuration, not a pending change.
            const session = useSessionStore.getState()
            if (
              selectionIsRunningCard(
                session,
                useProjectStore.getState().currentProject?.path
              )
            ) {
              session.setPendingChanges(true)
            }
          }}
        >
          {lanOptions.length === 0 && (
            <NativeSelectOption value="">
              {t('session.lanAddressHint')}
            </NativeSelectOption>
          )}
          {lanOptions.map(ip => (
            <NativeSelectOption key={ip} value={ip}>
              {ip}
            </NativeSelectOption>
          ))}
        </NativeSelect>
      </div>
      {modified && (
        <p className="text-muted-foreground text-xs" data-testid="node-hint">
          {t('settings.nodeHint')}
        </p>
      )}
    </section>
  )
}
