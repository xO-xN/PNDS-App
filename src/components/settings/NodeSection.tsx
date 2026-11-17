import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updatePreferences } from '@/lib/preferences'
import { chooseLanAddress, refreshLanAddresses } from '@/lib/lan-settings'
import { useLanInterfaceKinds } from '@/hooks/use-lan-interface-kinds'
import { LanAddressLabel } from './LanAddressLabel'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { selectSelectedPath, useProjectStore } from '@/store/project-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { projectDisplayName } from '@/lib/display-names'
import { SettingsCard } from '@/components/shell/SettingsCard'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { SettingsSection } from '@/store/settings-store'

import { SectionTitle } from './SectionTitle'
import { NodeNameField } from './DeviceIdentityGroup'
import { SettingsField } from './SettingsField'
import { SettingsGroup } from './SettingsGroup'

/**
 * Shared connection preferences. The full page owns LAN, Hub and its
 * separately stored token; the compact network panel retains the node-name
 * shortcut. General settings owns the full device identity form.
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
  const hubUrlSetting = useSettingsStore(state => state.hubUrlSetting)
  const hubTokenSetting = useSettingsStore(state => state.hubTokenSetting)
  const lanIp = useSessionStore(state => state.lanIp)
  const lanAddresses = useSessionStore(state => state.lanAddresses)
  const selectedProject = useProjectStore(state => state.currentProject)
  const selectedPath = useProjectStore(selectSelectedPath)
  const performanceName = useProjectStore(state =>
    state.currentProject
      ? projectDisplayName(
          state.currentProject.path,
          state.projectDisplayNames,
          state.manifestProjectNames,
          state.currentProject
        )
      : ''
  )
  const creationActive = useCreationStore(state => state.active)
  const workspace = useCreationStore(state => state.workspace)
  const creationManifest = useCreationTestStore(state => state.manifest)
  const creationMode = useCreationTestStore(state => state.audioMode)
  const performanceMode = useSessionStore(state => state.audioMode)
  const project = creationActive
    ? workspace && creationManifest
      ? { name: workspace.project.name, manifest: creationManifest }
      : null
    : selectedProject && selectedProject.path === selectedPath
      ? { name: performanceName, manifest: selectedProject.manifest }
      : null
  const projectAudioMode = creationActive ? creationMode : performanceMode
  const hasProjectConnections =
    project &&
    (projectAudioMode === 'external' || project.manifest.telematic === true)
  // The next-start note stays out of the way until it has something to
  // say: it appears once any row here is touched and stays for the rest
  // of the visit (closing the dialog unmounts the section, resetting it).
  const [modified, setModified] = useState(false)
  const snapshot = useSessionStore(state => state.latestSnapshot)
  const status = useSessionStore(state => state.sessionStatus)
  const applied =
    status === 'ready' && snapshot?.status === 'ready' ? snapshot : null
  const lanDifference =
    applied?.lanIp && applied.lanIp !== lanIp ? applied.lanIp : null
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
          {t('settings.presentation.navigation.node')}
        </SectionTitle>
      )}
      {compact && (
        <NodeNameField compact onModified={() => setModified(true)} />
      )}
      {/* LAN address (moved from the sidebar settings card): the machine's
          network situation, not a per-performance decision. Seeded at
          preflight, refreshed on panel/menu open; read at start (PNDS_HOST_IP). */}
      {!compact && (
        <SettingsGroup
          title={t('settings.presentation.networkGroup')}
          description={t('settings.presentation.networkGroupHint')}
          footer={
            modified || lanDifference ? (
              <span data-testid="node-hint">{t('settings.nodeHint')}</span>
            ) : undefined
          }
        >
          <SettingsField
            htmlFor="settings-lan-address"
            label={t('session.lanAddress')}
          >
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
          </SettingsField>
          <SettingsField
            htmlFor="settings-hub-url"
            label={t('settings.hubUrl')}
          >
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
              onBlur={commitHubConfig}
              className={inputClass}
            />
          </SettingsField>
          <SettingsField
            htmlFor="settings-hub-token"
            label={t('settings.hubToken')}
            description={t('settings.presentation.tokenHint')}
          >
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
          </SettingsField>
        </SettingsGroup>
      )}
      {!compact && hasProjectConnections && (
        <details className="settings-details">
          <summary className="pnds-focus-ring">
            {t('settings.presentation.projectConnection')}
            <span className="ms-2 text-xs text-(--pnds-text-secondary)">
              {project.name}
            </span>
          </summary>
          <p className="settings-field-description">
            {t('settings.presentation.projectConnectionHint', {
              project: project.name,
            })}
          </p>
          <SettingsCard
            quickNetwork
            networkFields="project"
            showAudioMode={false}
            showGain={false}
          />
        </details>
      )}
      {compact && (modified || pending) && (
        <p className="settings-notice" data-testid="node-hint">
          {t('settings.nodeHint')}
        </p>
      )}
    </section>
  )
}
