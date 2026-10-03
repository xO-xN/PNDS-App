import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileUp, Trash2 } from 'lucide-react'
import { open } from '@tauri-apps/plugin-dialog'
import i18n from '@/i18n/config'
import { commands, type HttpsValidationOutcome } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import {
  HTTPS_PORT_PLACEHOLDER,
  isHttpsDomainSet,
  isValidHttpsDomain,
  isValidHttpsPort,
  normalizeHttpsDomain,
  parseHttpsPort,
} from '@/lib/https-settings'
import { updatePreferences } from '@/lib/preferences'
import { openHelpWindow } from '@/lib/help-window'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore, type SettingsSection } from '@/store/settings-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'

import { SectionTitle } from './SectionTitle'

/** The problems the section itself can raise before the backend sees
 * anything (they use the same rendering as backend problem codes). */
type LocalProblemCode = 'domainRequired' | 'domainInvalid' | 'portInvalid'

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
  const lanIp = useSessionStore(state => state.lanIp)
  const [modified, setModified] = useState(false)
  const [domainError, setDomainError] = useState(false)
  const [portError, setPortError] = useState(false)
  const [material, setMaterial] = useState<HttpsValidationOutcome | null>(null)
  const [materialLoaded, setMaterialLoaded] = useState(false)
  const [importing, setImporting] = useState(false)
  const [localProblem, setLocalProblem] = useState<LocalProblemCode | null>(
    null
  )

  const refreshMaterial = () => {
    void commands.loadHttpsCertificate().then(result => {
      if (result.status === 'error') {
        logger.warn('Failed to load HTTPS certificate state', {
          error: result.error,
        })
        setMaterial(null)
      } else {
        setMaterial(result.data)
      }
      setMaterialLoaded(true)
    })
  }

  // The panel unmounts closed sections — mount == open, so one fetch per
  // visit re-derives expiry/warnings against the current clock.
  useEffect(() => {
    refreshMaterial()
  }, [])

  const commitDomain = () => {
    const raw = useSettingsStore.getState().httpsDomainSetting
    const normalized = normalizeHttpsDomain(raw)
    if (normalized === '' || isValidHttpsDomain(raw)) {
      setDomainError(false)
      void updatePreferences({
        httpsDomain: normalized === '' ? null : normalized,
      })
    } else {
      // Keep the row's value for the operator to fix, but keep it OUT of
      // the save queue — the backend would reject the whole file write.
      setDomainError(true)
    }
  }

  const commitPort = () => {
    const raw = useSettingsStore.getState().httpsPortSetting
    if (raw.trim() === '' || isValidHttpsPort(raw)) {
      setPortError(false)
      void updatePreferences({ httpsPort: parseHttpsPort(raw) })
    } else {
      setPortError(true)
    }
  }

  const handleImport = async () => {
    if (importing) return
    setLocalProblem(null)
    const domain = normalizeHttpsDomain(
      useSettingsStore.getState().httpsDomainSetting
    )
    // The certificate's SAN coverage is checked against what the operator
    // sees in the row — demand a valid domain before picking files.
    if (!isHttpsDomainSet(domain)) {
      setLocalProblem('domainRequired')
      return
    }
    if (!isValidHttpsDomain(domain)) {
      setLocalProblem('domainInvalid')
      return
    }
    const certificatePemPath = await open({
      multiple: false,
      title: i18n.t('settings.https.pickCertTitle'),
      filters: [
        {
          name: i18n.t('settings.https.pickCertFilter'),
          extensions: ['pem', 'crt', 'cer', 'txt'],
        },
      ],
    })
    if (!certificatePemPath) return
    const privateKeyPemPath = await open({
      multiple: false,
      title: i18n.t('settings.https.pickKeyTitle'),
      filters: [
        {
          name: i18n.t('settings.https.pickKeyFilter'),
          extensions: ['pem', 'key', 'txt'],
        },
      ],
    })
    if (!privateKeyPemPath) return

    setImporting(true)
    const result = await commands.importHttpsCertificate(
      domain,
      certificatePemPath,
      privateKeyPemPath
    )
    setImporting(false)
    if (result.status === 'error') {
      logger.error('HTTPS material import failed', {
        error: result.error,
      })
      return
    }
    if (result.data.summary) {
      setMaterial(result.data)
      setModified(true)
      return
    }
    // Refused: the stored material is untouched on disk, so keep its
    // summary on screen and attach the refusal problems to it — the
    // section must not visually "lose" a certificate it still holds.
    const stored = await commands.loadHttpsCertificate()
    setMaterial({
      summary: stored.status === 'ok' ? (stored.data?.summary ?? null) : null,
      problems: result.data.problems,
    })
  }

  const handleClear = async () => {
    const result = await commands.clearHttpsCertificate()
    if (result.status === 'error') {
      logger.error('HTTPS material clear failed', { error: result.error })
      return
    }
    setMaterial(null)
    setModified(true)
  }

  const summary = material?.summary ?? null
  const statusTone =
    summary == null
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
      <div className="flex items-center justify-between gap-4">
        <Label htmlFor="settings-https-domain" className="shrink-0">
          {t('settings.https.domain')}
        </Label>
        <Input
          id="settings-https-domain"
          value={httpsDomainSetting}
          placeholder="show.example.org"
          autoComplete="off"
          spellCheck={false}
          dir="ltr"
          onChange={event => {
            useSettingsStore
              .getState()
              .setHttpsDomainSetting(event.target.value)
            setDomainError(false)
            setModified(true)
          }}
          onBlur={commitDomain}
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
                onClick={() => void handleClear()}
              >
                <Trash2 data-slot="icon" />
                {t('settings.https.clear')}
              </Button>
            )}
            <Button
              variant="outline"
              size="sm"
              disabled={importing}
              onClick={() => void handleImport()}
            >
              <FileUp data-slot="icon" />
              {importing
                ? t('settings.https.importing')
                : t('settings.https.import')}
            </Button>
          </div>
        </div>
        {materialLoaded && !summary && (
          <p className="text-muted-foreground text-xs">
            {t('settings.https.noneStored')}
          </p>
        )}
        {summary && (
          <div className="flex flex-col gap-1">
            <p className={`text-xs ${statusTone}`} data-testid="https-status">
              {t(`settings.https.status.${summary.status}`)}
              {summary.status === 'expiringSoon' &&
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

      {modified && (
        <p className="text-muted-foreground text-xs" data-testid="https-hint">
          {t('settings.https.hint')}
        </p>
      )}
    </section>
  )
}
