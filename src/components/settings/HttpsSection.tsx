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

/** One validation finding: localized message keyed by code, the backend's
 * English detail kept visible underneath (dates, SANs, file paths). */
function ProblemLine({ label, detail }: { label: string; detail?: string }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5">
      <span className="text-(--pnds-danger) text-xs">{label}</span>
      {detail && (
        <span
          className="text-muted-foreground truncate font-mono text-xs"
          title={detail}
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
      ? ''
      : summary.status === 'valid' || summary.status === 'expiringSoon'
        ? 'text-(--pnds-accent-text)'
        : 'text-(--pnds-danger)'

  return (
    <section
      id={`settings-section-${section}`}
      aria-labelledby={`settings-${section}-title`}
      className="flex flex-col gap-3 py-4"
    >
      <SectionTitle id={`settings-${section}-title`}>
        {t('settings.https')}
      </SectionTitle>
      {/* #140: the entry switch — plain operator intent. Domain, port
          and material are validated here and again at start, so this
          only decides whether starts of declared projects open the
          gateway at all. Applies at the next start (the hint below). */}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-https-enabled" className="shrink-0">
          {t('settings.https.enabled')}
        </Label>
        <Switch
          id="settings-https-enabled"
          checked={httpsEnabledSetting}
          onCheckedChange={checked => {
            useSettingsStore.getState().setHttpsEnabledSetting(checked)
            void updatePreferences({ httpsEnabled: checked })
            setModified(true)
          }}
          data-testid="https-enabled-switch"
        />
      </div>
      <p className="text-muted-foreground text-xs">
        {t('settings.https.enabledNote')}
      </p>
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-https-domain" className="shrink-0">
          {t('settings.https.domain')}
        </Label>
        <Input
          id="settings-https-domain"
          disabled={operation !== null}
          value={httpsDomainSetting}
          placeholder="show.example.org"
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          onChange={event => {
            flow.current?.editDomain(event.target.value)
            setModified(true)
          }}
          onBlur={() => void flow.current?.commitDomain()}
          className="w-56"
        />
      </div>
      {domainError && (
        <p
          className="text-(--pnds-danger) text-xs"
          data-testid="https-domain-error"
        >
          {t('settings.https.domainInvalid')}
        </p>
      )}
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-https-port" className="shrink-0">
          {t('settings.https.port')}
        </Label>
        <Input
          id="settings-https-port"
          value={httpsPortSetting}
          placeholder={HTTPS_PORT_PLACEHOLDER}
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          inputMode="numeric"
          onChange={event => {
            useSettingsStore.getState().setHttpsPortSetting(event.target.value)
            setPortError(false)
            setModified(true)
          }}
          onBlur={commitPort}
          className="w-56"
        />
      </div>
      {portError && (
        <p
          className="text-(--pnds-danger) text-xs"
          data-testid="https-port-error"
        >
          {t('settings.https.portInvalid', {
            min: 1024,
            max: 65535,
          })}
        </p>
      )}

      {/* Certificate material: backend-protected, never a preference.
          The block states what is stored and why it does (not) stand;
          the note under the summary keeps "files valid" distinct from
          "phones can use it" (AC1) — the guide covers the rest. */}
      <div className="flex flex-col gap-2" data-testid="https-material">
        <div className="flex items-center justify-between gap-4">
          <Label className="shrink-0">{t('settings.https.certificate')}</Label>
          <div className="flex gap-2">
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
              disabled={operation !== null}
              onClick={() => void flow.current?.importMaterial()}
            >
              <FileUp data-slot="icon" />
              {operation === 'import'
                ? t('settings.https.importing')
                : t('settings.https.import')}
            </Button>
          </div>
        </div>
        {materialLoaded && !summary && localProblem !== 'loadFailed' && (
          <p className="text-muted-foreground text-xs">
            {t('settings.https.noneStored')}
          </p>
        )}
        {summary && (
          <div className="flex flex-col gap-1">
            <p className={`text-xs ${statusTone}`} data-testid="https-status">
              {summaryCurrent
                ? t(`settings.https.status.${summary.status}`)
                : t('settings.https.revalidate')}
              {summaryCurrent &&
                summary.status === 'expiringSoon' &&
                t('settings.https.expiresIn', {
                  count: summary.daysRemaining,
                })}
            </p>
            <p className="text-muted-foreground text-xs">
              {t('settings.https.subject')}: {summary.subject}
              {' · '}
              {t('settings.https.validUntil')}{' '}
              {formatValidity(summary.notAfter)}
            </p>
            <p
              className="text-muted-foreground truncate font-mono text-xs"
              title={summary.fingerprint}
              dir="ltr"
            >
              {summary.fingerprint}
            </p>
            {/* AC1: passing these checks is file validity — phone
                usability still needs the router DNS and a real-device
                scan test (the guide covers both). */}
            <p className="text-muted-foreground text-xs">
              {t('settings.https.fileValidNote')}
            </p>
          </div>
        )}
        {(material?.problems?.length || localProblem) && (
          <ul className="flex flex-col gap-1">
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
      </div>

      {/* DNS guidance: the router resolves the domain to the machine's
          selected LAN address (the「节点」section's selector owns it). */}
      <p className="text-muted-foreground text-xs">
        {t('settings.https.dnsHint', { lanIp: lanIp ?? '—' })}
      </p>

      <div className="flex flex-wrap justify-end gap-2">
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

      {(modified || preparation.materialChanged) && (
        <p className="text-muted-foreground text-xs" data-testid="https-hint">
          {t('settings.https.hint')}
        </p>
      )}
    </section>
  )
}
