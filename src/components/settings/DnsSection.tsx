import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { commands, type DnsServiceStatus } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { updatePreferences } from '@/lib/preferences'
import { openHelpWindow } from '@/lib/help-window'
import { useSettingsStore, type SettingsSection } from '@/store/settings-store'
import { useSessionStore } from '@/store/session-store'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import { SectionTitle } from './SectionTitle'

/** #174: the settings「演出 DNS」section — the operator's surface for the
 * background LAN-DNS daemon. The switch registers/unregisters the
 * LaunchDaemon (the system's one-time approval dialog); the forwarding
 * upstreams are the App's built-in defaults (the editor was retired in
 * the post-#174 polish round — defaults cover the venue case and the
 * status block still reports what the daemon actually uses). Help:
 * reference-dns covers router DHCP, revocation, uninstall. */
export function DnsSection({ section }: { section: SettingsSection }) {
  const { t } = useTranslation()
  const dnsEnabledSetting = useSettingsStore(state => state.dnsEnabledSetting)
  const [status, setStatus] = useState<DnsServiceStatus | null>(null)
  const [working, setWorking] = useState(false)

  const refreshStatus = () => {
    // dns_service_status returns the status bare — a down daemon is a
    // fact inside the object, not a Result error; only a transport
    // failure rejects, and that renders "status unavailable".
    void commands
      .dnsServiceStatus()
      .then(setStatus)
      .catch(error => {
        logger.warn('Failed to load DNS service status', { error })
        setStatus(null)
      })
  }

  // The panel unmounts closed sections — mount == open, so every visit
  // re-reads the daemon's own truth (registration + control plane).
  useEffect(() => {
    refreshStatus()
  }, [])

  const toggleEnabled = async (checked: boolean) => {
    useSettingsStore.getState().setDnsEnabledSetting(checked)
    setWorking(true)
    if (checked) {
      // The fixed listen address is the operator's chosen LAN address —
      // the same address the HTTPS entry binds and mappings point to.
      // Upstreams are null → the backend applies the App's defaults.
      const listenIp = useSessionStore.getState().lanIp
      const result = await commands.dnsServiceEnable(null, listenIp)
      if (result.status === 'error') {
        logger.error('DNS service enable failed', { error: result.error })
        // The intent stays recorded (next launches retry), but the switch
        // reflects reality: the daemon did not come up.
        useSettingsStore.getState().setDnsEnabledSetting(false)
        setWorking(false)
        return
      }
      void updatePreferences({ dnsEnabled: true })
    } else {
      const result = await commands.dnsServiceDisable()
      if (result.status === 'error') {
        logger.error('DNS service disable failed', { error: result.error })
      } else {
        void updatePreferences({ dnsEnabled: false })
      }
    }
    setWorking(false)
    refreshStatus()
  }

  const registration = status?.registration ?? null
  const mapping = status?.mapping ?? null
  const listenerProblem =
    status?.daemon && (!status.listeners?.udp || !status.listeners?.tcp)

  return (
    <section
      id={`settings-section-${section}`}
      aria-labelledby={`settings-${section}-title`}
      className="settings-section"
      aria-busy={working}
    >
      <SectionTitle id={`settings-${section}-title`}>
        {t('settings.dns.title')}
      </SectionTitle>
      <div className="settings-fields">
        <div className="settings-field">
          <Label
            htmlFor="settings-dns-enabled"
            className="settings-field-label"
          >
            {t('settings.dns.enabled')}
          </Label>
          <div className="settings-field-control">
            <Switch
              id="settings-dns-enabled"
              checked={dnsEnabledSetting}
              disabled={working}
              aria-describedby="settings-dns-permission"
              onCheckedChange={checked => void toggleEnabled(checked)}
              data-testid="dns-enabled-switch"
            />
            <p
              id="settings-dns-permission"
              className="settings-field-description"
            >
              {t('settings.presentation.dnsPermission')}
            </p>
          </div>
        </div>
      </div>

      <div
        className="settings-section"
        data-testid="dns-status"
        aria-live="polite"
      >
        {status === null ? (
          <p className="settings-feedback" data-tone="neutral">
            {t('settings.dns.statusUnavailable')}
          </p>
        ) : (
          <>
            <dl className="settings-facts">
              <dt>{t('settings.presentation.dnsRegistration')}</dt>
              <dd data-testid="dns-registration">
                {t(`settings.dns.status.${registration}`)}
              </dd>
              <dt>{t('settings.presentation.dnsServiceStatus')}</dt>
              <dd>
                {t(
                  status.daemon
                    ? 'settings.presentation.running'
                    : 'settings.presentation.notRunning'
                )}
              </dd>
              <dt>{t('settings.presentation.dnsMapping')}</dt>
              <dd>
                {mapping ? (
                  <span
                    className="settings-inline-status"
                    data-testid="dns-mapping"
                    dir="ltr"
                  >
                    {mapping.domain}
                    {' → '}
                    {mapping.ip}
                  </span>
                ) : (
                  t('settings.dns.mappingNone')
                )}
              </dd>
            </dl>
            {status.bindError && (
              <p
                className="settings-feedback"
                data-tone="danger"
                data-testid="dns-bind-error"
              >
                {t('settings.dns.bindError')}
              </p>
            )}
            {listenerProblem && (
              <p className="settings-feedback" data-tone="danger" dir="ltr">
                {t('settings.dns.listeners', {
                  udp: status.listeners?.udp ? 'UDP' : '—',
                  tcp: status.listeners?.tcp ? 'TCP' : '—',
                })}
              </p>
            )}
          </>
        )}
      </div>
      {mapping && (
        <p className="settings-field-description">
          {t('settings.presentation.dnsMappingScope')}
        </p>
      )}

      <div className="settings-actions">
        {status?.registration === 'requiresApproval' && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => void commands.dnsServiceOpenSystemSettings()}
          >
            {t('settings.dns.openSystemSettings')}
          </Button>
        )}
        <Button variant="outline" size="sm" onClick={refreshStatus}>
          <RefreshCw data-slot="icon" />
          {t('settings.dns.refresh')}
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={() =>
            void openHelpWindow({ kind: 'doc', docId: 'reference-dns' })
          }
        >
          {t('settings.dns.help')}
        </Button>
      </div>
      <details className="settings-details">
        <summary>{t('settings.presentation.dnsDetails')}</summary>
        {status?.daemon && !listenerProblem && (
          <p className="settings-field-description" dir="ltr">
            {t('settings.dns.listeners', {
              udp: status.listeners?.udp ? 'UDP' : '—',
              tcp: status.listeners?.tcp ? 'TCP' : '—',
            })}
            {status.upstreams.length > 0 &&
              t('settings.dns.upstreamsValue', {
                upstreams: status.upstreams.join(', '),
              })}
          </p>
        )}
        {status?.daemon && listenerProblem && status.upstreams.length > 0 && (
          <dl className="settings-facts">
            <dt>{t('settings.presentation.dnsUpstreams')}</dt>
            <dd dir="ltr">{status.upstreams.join(', ')}</dd>
          </dl>
        )}
        <p className="settings-field-description">{t('settings.dns.intro')}</p>
        <p className="settings-field-description">
          {t('settings.dns.enabledNote')}
        </p>
      </details>
    </section>
  )
}
