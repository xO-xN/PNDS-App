import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
import { commands, type DnsServiceStatus } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { notifications } from '@/lib/notifications'
import { updatePreferences } from '@/lib/preferences'
import { openHelpWindow } from '@/lib/help-window'
import { useSettingsStore, type SettingsSection } from '@/store/settings-store'
import { useSessionStore } from '@/store/session-store'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import { SectionTitle } from './SectionTitle'

let feedbackSequence = 0
let pendingMutation: Promise<void> | null = null

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
  const [working, setWorking] = useState(true)
  const [readFailed, setReadFailed] = useState(false)
  const mounted = useRef(false)
  const request = useRef<{ id: string; valid: boolean } | null>(null)

  const acquire = (operation: 'read' | 'enable' | 'disable') => {
    if (request.current) return null
    const owner = { id: `dns-operation:${++feedbackSequence}`, valid: true }
    request.current = owner
    setWorking(true)
    setReadFailed(false)
    notifications.flow.step(owner.id, t(`settings.dns.feedback.${operation}`))
    return owner
  }
  const owns = (owner: { valid: boolean }) =>
    mounted.current && owner.valid && request.current === owner
  const release = (owner: { id: string }, settled: boolean) => {
    if (!settled) notifications.flow.dismiss(owner.id)
    if (request.current === owner) {
      request.current = null
      if (mounted.current) setWorking(false)
    }
  }
  const refreshStatus = async () => {
    const owner = acquire('read')
    if (!owner) return
    let settled = false
    try {
      // Reopening the panel cannot race a native mutation from its old owner.
      await pendingMutation
      if (!owns(owner)) return
      const next = await commands.dnsServiceStatus()
      if (!owns(owner)) return
      setStatus(next)
      notifications.flow.message(owner.id, t('settings.dns.feedback.readDone'))
      settled = true
    } catch (error) {
      if (owns(owner)) {
        logger.warn('Failed to load DNS service status', { error })
        setStatus(null)
        setReadFailed(true)
        notifications.flow.fail(owner.id, t('settings.dns.feedback.readFailed'))
        settled = true
      }
    } finally {
      release(owner, settled)
    }
  }

  const refreshOnMount = useEffectEvent(() => {
    void refreshStatus()
  })
  // Hidden categories remain mounted; closing/reopening reads native facts.
  useEffect(() => {
    mounted.current = true
    refreshOnMount()
    return () => {
      mounted.current = false
      if (request.current) {
        request.current.valid = false
        notifications.flow.dismiss(request.current.id)
        request.current = null
      }
    }
  }, [])

  const toggleEnabled = async (checked: boolean) => {
    if (pendingMutation) return
    const owner = acquire(checked ? 'enable' : 'disable')
    if (!owner) return
    const previous = useSettingsStore.getState().dnsEnabledSetting
    useSettingsStore.getState().setDnsEnabledSetting(checked)
    const task = (async () => {
      let changed = false
      let settled = false
      try {
        const result = checked
          ? await commands.dnsServiceEnable(
              null,
              useSessionStore.getState().lanIp
            )
          : await commands.dnsServiceDisable()
        if (result.status === 'error') throw result.error
        changed = true
        // A dispatched native change still saves its intent after panel closure.
        const saved = await updatePreferences({ dnsEnabled: checked })
        if (!owns(owner)) return
        notifications.flow.step(owner.id, t('settings.dns.feedback.read'))
        const next = await commands.dnsServiceStatus()
        if (!owns(owner)) return
        setStatus(next)
        if (!saved) {
          notifications.flow.warn(
            owner.id,
            t('settings.dns.feedback.notPersisted')
          )
        } else if (next.registration === 'requiresApproval') {
          notifications.flow.warn(
            owner.id,
            t('settings.dns.status.requiresApproval')
          )
        } else if (
          checked
            ? next.registration === 'enabled' &&
              next.daemon &&
              next.listeners?.udp &&
              next.listeners.tcp &&
              !next.bindError
            : next.registration === 'notRegistered' && !next.daemon
        ) {
          notifications.flow.succeed(
            owner.id,
            t(`settings.dns.feedback.${checked ? 'enabled' : 'disabled'}`)
          )
        } else {
          notifications.flow.warn(
            owner.id,
            t('settings.dns.feedback.statePending')
          )
        }
        settled = true
      } catch (error) {
        if (!changed) useSettingsStore.getState().setDnsEnabledSetting(previous)
        if (owns(owner)) {
          logger.error('DNS service operation failed', { checked, error })
          if (changed) {
            setStatus(null)
            setReadFailed(true)
            notifications.flow.warn(
              owner.id,
              t('settings.dns.feedback.statusUnknown')
            )
          } else {
            notifications.flow.fail(
              owner.id,
              t('settings.dns.feedback.changeFailed'),
              String(error)
            )
          }
          settled = true
        }
      } finally {
        release(owner, settled)
      }
    })()
    pendingMutation = task
    await task
    if (pendingMutation === task) pendingMutation = null
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
          <p
            className="settings-feedback"
            data-tone={readFailed ? 'danger' : 'neutral'}
          >
            {t(
              working
                ? 'settings.dns.feedback.read'
                : readFailed
                  ? 'settings.dns.feedback.readFailed'
                  : 'settings.dns.statusUnavailable'
            )}
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
        <Button
          variant="outline"
          size="sm"
          disabled={working}
          onClick={() => void refreshStatus()}
        >
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
