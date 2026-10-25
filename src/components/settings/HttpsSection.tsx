import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp, Trash2 } from 'lucide-react'
import {
  HTTPS_PORT_PLACEHOLDER,
  isValidHttpsPort,
  normalizeHttpsDomain,
  parseHttpsPort,
} from '@/lib/https-settings'
import {
  attachHttpsPreparation,
  INITIAL_HTTPS_PREPARATION,
  type HttpsPreparation,
} from '@/lib/https-preparation'
import { updatePreferences } from '@/lib/preferences'
import { openHelpWindow } from '@/lib/help-window'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore, type SettingsSection } from '@/store/settings-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'

import { SectionTitle } from './SectionTitle'

function formatValidity(iso: string): string {
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

/** Keep actionable problems and their concrete backend facts directly readable. */
function ProblemLine({ label, detail }: { label: string; detail?: string }) {
  return (
    <li className="settings-feedback" data-tone="danger">
      <span>{label}</span>
      {detail && (
        <span
          className="block font-mono text-xs [overflow-wrap:anywhere]"
          dir="ltr"
        >
          {detail}
        </span>
      )}
    </li>
  )
}

/**
 * #139: the settings「可信 HTTPS」section — the operator's preparation
 * surface for the local trusted-HTTPS performer entry (#137/#139; the
 * gateway itself arrives with #140). Domain and port are normal
 * preferences (blur-committed through the serialized queue; invalid
 * values are held back so one bad field cannot fail the whole save);
 * the certificate chain + private key are imported, validated and
 * protected-stored by the backend and never ride preferences.
 *
 * Everything here applies at the NEXT project start — a running
 * performance keeps the environment it was spawned with.
 */
export function HttpsSection({ section }: { section: SettingsSection }) {
  const { t } = useTranslation()
  const httpsDomainSetting = useSettingsStore(state => state.httpsDomainSetting)
  const httpsPortSetting = useSettingsStore(state => state.httpsPortSetting)
  const httpsEnabledSetting = useSettingsStore(
    state => state.httpsEnabledSetting
  )
  const lanIp = useSessionStore(state => state.lanIp)
  const [modified, setModified] = useState(false)
  const [portError, setPortError] = useState(false)
  const [preparation, setPreparation] = useState(INITIAL_HTTPS_PREPARATION)
  const flow = useRef<HttpsPreparation | null>(null)
  const {
    material,
    loaded: materialLoaded,
    operation,
    localProblem,
    domainError,
  } = preparation

  // Mount == open. Each visit revalidates expiry and the saved domain.
  useEffect(() => {
    const attached = attachHttpsPreparation(setPreparation)
    flow.current = attached
    return () => {
      flow.current = null
      attached.dispose()
    }
  }, [])

  const commitPort = () => {
    const raw = useSettingsStore.getState().httpsPortSetting
    if (raw.trim() === '' || isValidHttpsPort(raw)) {
      setPortError(false)
      void updatePreferences({ httpsPort: parseHttpsPort(raw) })
    } else {
      setPortError(true)
    }
  }

  const summary = material?.summary ?? null
  const summaryCurrent =
    preparation.checkedDomain === normalizeHttpsDomain(httpsDomainSetting)
  const statusTone =
    summary == null || !summaryCurrent
      ? 'neutral'
      : summary.status === 'valid'
        ? 'success'
        : summary.status === 'expiringSoon'
          ? 'warning'
          : 'danger'

  return (
    <section
      id={`settings-section-${section}`}
      aria-labelledby={`settings-${section}-title`}
      className="settings-section"
    >
      <SectionTitle id={`settings-${section}-title`}>
        {t('settings.https')}
      </SectionTitle>
      <div className="settings-fields">
        <div className="settings-field">
          <Label
            htmlFor="settings-https-enabled"
            className="settings-field-label"
          >
            {t('settings.https.enabled')}
          </Label>
          <div className="settings-field-control">
            <Switch
              id="settings-https-enabled"
              aria-describedby="settings-https-enabled-hint"
              checked={httpsEnabledSetting}
              onCheckedChange={checked => {
                useSettingsStore.getState().setHttpsEnabledSetting(checked)
                void updatePreferences({ httpsEnabled: checked })
                setModified(true)
              }}
              data-testid="https-enabled-switch"
            />
            <p
              id="settings-https-enabled-hint"
              className="settings-field-description"
              data-testid={
                modified || preparation.materialChanged
                  ? 'https-hint'
                  : undefined
              }
            >
              {t('settings.https.hint')}
            </p>
          </div>
        </div>
        <div className="settings-field">
          <Label
            htmlFor="settings-https-domain"
            className="settings-field-label"
          >
            {t('settings.https.domain')}
          </Label>
          <div className="settings-field-control">
            <Input
              id="settings-https-domain"
              disabled={operation !== null}
              value={httpsDomainSetting}
              placeholder="show.example.org"
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              aria-invalid={domainError || undefined}
              aria-describedby={
                domainError ? 'settings-https-domain-error' : undefined
              }
              onChange={event => {
                flow.current?.editDomain(event.target.value)
                setModified(true)
              }}
              onBlur={() => void flow.current?.commitDomain()}
            />
            {domainError && (
              <p
                id="settings-https-domain-error"
                className="settings-feedback"
                data-tone="danger"
                data-testid="https-domain-error"
              >
                {t('settings.https.domainInvalid')}
              </p>
            )}
          </div>
        </div>
        <div className="settings-field">
          <Label htmlFor="settings-https-port" className="settings-field-label">
            {t('settings.https.port')}
          </Label>
          <div className="settings-field-control">
            <Input
              id="settings-https-port"
              value={httpsPortSetting}
              placeholder={HTTPS_PORT_PLACEHOLDER}
              autoComplete="off"
              spellCheck={false}
              dir="ltr"
              inputMode="numeric"
              aria-invalid={portError || undefined}
              aria-describedby={
                portError ? 'settings-https-port-error' : undefined
              }
              onChange={event => {
                useSettingsStore
                  .getState()
                  .setHttpsPortSetting(event.target.value)
                setPortError(false)
                setModified(true)
              }}
              onBlur={commitPort}
            />
            {portError && (
              <p
                id="settings-https-port-error"
                className="settings-feedback"
                data-tone="danger"
                data-testid="https-port-error"
              >
                {t('settings.https.portInvalid', { min: 1024, max: 65535 })}
              </p>
            )}
          </div>
        </div>
      </div>

      {/* Certificate material: backend-protected, never a preference.
          The block states what is stored and why it does (not) stand;
          the note under the summary keeps "files valid" distinct from
          "phones can use it" (AC1) — the guide covers the rest. */}
      <div
        className="settings-section"
        data-testid="https-material"
        aria-busy={operation !== null}
      >
        <h3 className="settings-subheading">
          {t('settings.https.certificate')}
        </h3>
        {materialLoaded && !summary && localProblem !== 'loadFailed' && (
          <p className="settings-field-description">
            {t('settings.https.noneStored')}
          </p>
        )}
        {summary && (
          <>
            <p
              className="settings-feedback"
              data-tone={statusTone}
              data-testid="https-status"
              role="status"
            >
              {summaryCurrent
                ? t(`settings.https.status.${summary.status}`)
                : t('settings.https.revalidate')}
              {summaryCurrent &&
                summary.status === 'expiringSoon' &&
                t('settings.https.expiresIn', {
                  count: summary.daysRemaining,
                })}
            </p>
            <dl className="settings-facts">
              <dt>{t('settings.https.validUntil')}</dt>
              <dd>
                <time dateTime={summary.notAfter}>
                  {formatValidity(summary.notAfter)}
                </time>
              </dd>
            </dl>
            <details className="settings-details">
              <summary>{t('settings.presentation.certificateDetails')}</summary>
              <dl className="settings-facts">
                <dt>{t('settings.https.subject')}</dt>
                <dd>{summary.subject}</dd>
                <dt>{t('settings.presentation.certificateFingerprint')}</dt>
                <dd className="font-mono [overflow-wrap:anywhere]" dir="ltr">
                  {summary.fingerprint}
                </dd>
              </dl>
            </details>
            {/* AC1: passing these checks is file validity — phone
                usability still needs the router DNS and a real-device
                scan test (the guide covers both). */}
            <p className="settings-field-description">
              {t('settings.https.fileValidNote')}
            </p>
          </>
        )}
        {(material?.problems?.length || localProblem) && (
          <ul className="flex flex-col gap-2" aria-live="polite">
            {localProblem && (
              <ProblemLine label={t(`settings.https.local.${localProblem}`)} />
            )}
            {material?.problems?.map((problem, index) => (
              <ProblemLine
                key={index}
                label={t(`settings.https.problem.${problem.code}`)}
                detail={problem.detail}
              />
            ))}
          </ul>
        )}
        <div className="settings-actions">
          <Button
            variant="outline"
            size="sm"
            disabled={operation !== null}
            onClick={() => void flow.current?.importMaterial()}
          >
            <FileUp data-slot="icon" />
            {operation === 'import'
              ? t('settings.https.importing')
              : t('settings.https.import')}
          </Button>
          {summary && (
            <Button
              variant="outline"
              size="sm"
              disabled={operation !== null}
              onClick={() => void flow.current?.clearMaterial()}
            >
              <Trash2 data-slot="icon" />
              {t('settings.https.clear')}
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void openHelpWindow({ kind: 'doc', docId: 'reference-https' })
            }
          >
            {t('settings.https.prepareGuide')}
          </Button>
        </div>
      </div>

      {/* DNS guidance: the router resolves the domain to the machine's
          selected LAN address (the「节点」section's selector owns it). */}
      <details className="settings-details">
        <summary>{t('settings.presentation.httpsPreparation')}</summary>
        <p className="settings-field-description">
          {t('settings.https.enabledNote')}
        </p>
        <p className="settings-field-description">
          {t('settings.https.dnsHint', { lanIp: lanIp ?? '—' })}
        </p>
      </details>
    </section>
  )
}
