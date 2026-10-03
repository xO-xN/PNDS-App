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

  return (
    <section
      id={`settings-section-${section}`}
      aria-labelledby={`settings-${section}-title`}
      className="flex flex-col gap-3 py-4"
    >
      <SectionTitle id={`settings-${section}-title`}>
        {t('settings.dns.title')}
      </SectionTitle>
      <p className="text-muted-foreground text-xs">{t('settings.dns.intro')}</p>

      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-dns-enabled" className="shrink-0">
          {t('settings.dns.enabled')}
        </Label>
        <Switch
          id="settings-dns-enabled"
          checked={dnsEnabledSetting}
          disabled={working}
          onCheckedChange={checked => void toggleEnabled(checked)}
          data-testid="dns-enabled-switch"
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {t('settings.dns.enabledNote')}
      </p>

      <div className="flex flex-col gap-1" data-testid="dns-status">
        {status === null ? (
          <p className="text-muted-foreground text-xs">
            {t('settings.dns.statusUnavailable')}
          </p>
        ) : (
          <>
            <p className="text-xs" data-testid="dns-registration">
              {t(`settings.dns.status.${registration}`)}
            </p>
            {status.registration === 'requiresApproval' && (
              <div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void commands.dnsServiceOpenSystemSettings()}
                >
                  {t('settings.dns.openSystemSettings')}
                </Button>
              </div>
            )}
            {status.bindError && (
              <p
                className="text-(--pnds-danger) text-xs"
                data-testid="dns-bind-error"
              >
                {t('settings.dns.bindError')}
              </p>
            )}
            {status.daemon && (
              <p className="text-muted-foreground text-xs" dir="ltr">
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
            {mapping ? (
              <p
                className="text-(--pnds-accent-text) text-xs"
                data-testid="dns-mapping"
                dir="ltr"
              >
                {t('settings.dns.mappingActive', {
                  domain: mapping.domain,
                  ip: mapping.ip,
                })}
              </p>
            ) : (
              <p className="text-muted-foreground text-xs">
                {t('settings.dns.mappingNone')}
              </p>
            )}
          </>
        )}
      </div>

      <div className="flex flex-wrap justify-end gap-2">
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
    </section>
  )
}
