import { useEffect, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { ChevronDown, Copy } from 'lucide-react'
import { commands } from '@/lib/tauri-bindings'
import { useHostEntryStore } from '@/store/host-entry-store'
import { useSessionStore } from '@/store/session-store'
import { participationErrorText } from '@/lib/participation-errors'
import { performerQrUrl } from '@/lib/performer-qr'
import { notifications } from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { useCreationTestEntry } from '@/hooks/use-creation-test-entry'
import { useCreationStore } from '@/store/creation-store'
import { isCreationWorkspacePath } from '@/store/creation-files-store'
import { SettingsGroup } from '@/components/settings/SettingsGroup'

function EntryQr({ url }: { url: string }) {
  const { t } = useTranslation()
  const [shown, setShown] = useState(false)
  return (
    <>
      <button
        type="button"
        className="host-client-copy pnds-focus-ring"
        aria-expanded={shown}
        onClick={() => setShown(!shown)}
      >
        {t(
          shown
            ? 'participation.publicEntry.hideQr'
            : 'participation.publicEntry.showQr'
        )}
      </button>
      {shown && <EntryQrImage url={url} />}
    </>
  )
}

export function EntryQrImage({
  url,
  generation,
}: {
  url: string
  generation?: string
}) {
  const { t } = useTranslation()
  const [image, setImage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    const request = generation
      ? commands.getCreationPerformerQr(url, generation)
      : commands.getHostEntryQr(url)
    void request
      .then(result => {
        if (result.status === 'error') {
          logger.warn('Failed to generate public entry QR', {
            error: result.error,
          })
          if (active) setFailed(true)
        } else if (active) setImage(result.data)
      })
      .catch(error => {
        logger.warn('Failed to request public entry QR', { error })
        if (active) setFailed(true)
      })
    return () => {
      active = false
    }
  }, [url, generation, attempt])
  if (failed)
    return (
      <>
        <p role="alert">{t('participation.publicEntry.qrFailed')}</p>
        <button
          type="button"
          className="host-client-copy pnds-focus-ring"
          onClick={() => {
            setFailed(false)
            setAttempt(attempt + 1)
          }}
        >
          {t('participation.publicEntry.qrRetry')}
        </button>
      </>
    )
  return image ? (
    <img
      className="public-entry-qr"
      src={image}
      alt={t(generation ? 'qr.imageAlt' : 'participation.publicEntry.qrAlt')}
    />
  ) : (
    <p role="status">{t('participation.publicEntry.qrPreparing')}</p>
  )
}

function SettingsEntryCard({
  title,
  status,
  tone,
  url,
  available,
  onCopy,
  children,
}: {
  title: string
  status: string
  tone: 'neutral' | 'success' | 'danger'
  url: string | null
  available: boolean
  onCopy: () => void
  children?: ReactNode
}) {
  const { t } = useTranslation()
  return (
    <SettingsGroup
      title={title}
      className="settings-published-entry"
      status={
        <span
          className="settings-entry-status"
          data-tone={tone}
          role={tone === 'danger' ? 'alert' : 'status'}
        >
          {status}
        </span>
      }
    >
      <div className="settings-entry-address-row">
        {url ? (
          <bdi dir="ltr" tabIndex={0} className="settings-entry-address">
            {url}
          </bdi>
        ) : (
          <span className="settings-entry-address">—</span>
        )}
        <button
          type="button"
          className="settings-entry-copy pnds-focus-ring"
          disabled={!url || !available}
          aria-label={t('participation.copyEntry')}
          title={t('participation.copyEntry')}
          onClick={onCopy}
        >
          <Copy aria-hidden="true" />
        </button>
      </div>
      {children && <div className="settings-entry-notices">{children}</div>}
    </SettingsGroup>
  )
}

function CreationSettingsEntry() {
  const { t } = useTranslation()
  const { url, generation, status } = useCreationTestEntry()
  const identity = useCreationStore(state => state.workspace?.project.identity)
  return (
    <SettingsEntryCard
      title={t('creation.testEntry.title')}
      status={t(
        url
          ? 'creation.testStatus.ready'
          : status === 'ready'
            ? 'creation.testEntry.unavailable'
            : `creation.testStatus.${status}`
      )}
      tone={
        url
          ? 'success'
          : status === 'error' || status === 'ready'
            ? 'danger'
            : 'neutral'
      }
      url={url}
      available={!!url}
      onCopy={() => {
        const creation = useCreationStore.getState()
        const current = useSessionStore.getState()
        if (
          !url ||
          !creation.active ||
          creation.opening ||
          creation.modePhase !== 'idle' ||
          creation.workspace?.project.identity !== identity ||
          !isCreationWorkspacePath(current.sessionProjectPath) ||
          current.commandPending ||
          current.sessionStatus !== 'ready' ||
          current.latestSnapshot?.runtimeGeneration !== generation ||
          performerQrUrl(current.latestSnapshot) !== url
        )
          return
        void writeText(url)
          .then(() => notifications.success(t('menu.addressCopied')))
          .catch(error => {
            logger.warn('Failed to copy test performer address', { error })
            notifications.error(t('participation.copyFailed'))
          })
      }}
    />
  )
}

/** Display only facts from the held native listener; opening this is read-only. */
export function PublicEntryDetails({
  compact = false,
  variant,
}: {
  compact?: boolean
  variant?: 'settings'
}) {
  const { t } = useTranslation()
  const entry = useHostEntryStore(state => state.snapshot)
  const status = useSessionStore(state => state.sessionStatus)
  const snapshot = useSessionStore(state => state.latestSnapshot)
  const creationActive = useCreationStore(state => state.active)
  const live =
    status === 'ready' && snapshot?.status === 'ready' ? snapshot : null
  const ports = live?.appliedPorts ?? live?.health?.scoreServer
  const available = entry.status !== 'error' && entry.status !== 'unbound'
  const unadapted = !!entry.projectName && entry.browserParticipation !== 1
  const legacy = unadapted && live ? performerQrUrl(live) : null
  const copy = (url: string) =>
    void writeText(url)
      .then(() => notifications.success(t('menu.addressCopied')))
      .catch(error => {
        logger.warn('Failed to copy participation entry address', { error })
        notifications.error(t('participation.copyFailed'))
      })
  const copyCurrent = () => {
    const current = useHostEntryStore.getState().snapshot
    if (
      current.url &&
      current.url === entry.url &&
      current.status !== 'error' &&
      current.status !== 'unbound'
    )
      copy(current.url)
  }
  const diagnostics = (
    <>
      {entry.portChanged && (
        <p role="status">{t('participation.publicEntry.portChanged')}</p>
      )}
      {entry.error && <p role="alert">{participationErrorText(entry.error)}</p>}
      {entry.status === 'error' && live && (
        <p>{t('participation.hostEntryFaultHint')}</p>
      )}
      {unadapted && (
        <p role="status">{t('participation.publicEntry.adaptationRequired')}</p>
      )}
      {((variant !== 'settings' && (entry.url || live || entry.error)) ||
        legacy ||
        entry.error) && (
        <details className="host-client-port-details">
          <summary className="pnds-focus-ring">
            {t('participation.hostPortDetails')}
            <ChevronDown aria-hidden="true" />
          </summary>
          {live?.projectName && !entry.projectName && <p>{live.projectName}</p>}
          <dl>
            {entry.error && (
              <>
                <dt>{t('participation.hostEntryFailureDetails')}</dt>
                <dd>{entry.error}</dd>
              </>
            )}
            {entry.url && (
              <>
                <dt>{t('participation.hostEntry')}</dt>
                <dd>
                  <bdi dir="ltr">
                    {new URL(entry.url).port ||
                      (entry.url.startsWith('https:') ? '443' : '80')}
                  </bdi>
                </dd>
              </>
            )}
            {ports?.performerPort != null && (
              <>
                <dt>{t('participation.performerService')}</dt>
                <dd>
                  <bdi dir="ltr">{ports.performerPort}</bdi>
                </dd>
              </>
            )}
            {ports?.monitorPort != null && (
              <>
                <dt>{t('participation.monitorService')}</dt>
                <dd>
                  <bdi dir="ltr">{ports.monitorPort}</bdi>
                </dd>
              </>
            )}
          </dl>
          {legacy && (
            <div className="public-entry-legacy">
              <h4>{t('participation.publicEntry.legacyTitle')}</h4>
              <p>
                <bdi dir="ltr">{legacy}</bdi>
              </p>
              <p>{t('participation.publicEntry.legacyHelp')}</p>
              <button
                type="button"
                className="host-client-copy pnds-focus-ring"
                onClick={() => {
                  const current = useSessionStore.getState()
                  const publicEntry = useHostEntryStore.getState().snapshot
                  if (
                    current.sessionStatus === 'ready' &&
                    current.latestSnapshot === live &&
                    publicEntry.projectName === entry.projectName &&
                    publicEntry.browserParticipation !== 1 &&
                    performerQrUrl(current.latestSnapshot) === legacy
                  )
                    copy(legacy)
                }}
              >
                {t('participation.publicEntry.copyLegacy')}
              </button>
            </div>
          )}
        </details>
      )}
    </>
  )
  if (variant === 'settings') {
    if (creationActive) return <CreationSettingsEntry />
    return (
      <SettingsEntryCard
        title={t('participation.publicEntry.title')}
        status={t(`participation.publicEntry.${entry.status}`)}
        tone={
          entry.status === 'error'
            ? 'danger'
            : entry.status === 'ready'
              ? 'success'
              : 'neutral'
        }
        url={entry.url}
        available={available}
        onCopy={copyCurrent}
      >
        {diagnostics}
      </SettingsEntryCard>
    )
  }
  if (compact)
    return (
      <section
        className="public-entry-details public-entry-compact"
        aria-label={t('participation.publicEntry.title')}
      >
        <p className="public-entry-caption">
          {t('participation.publicEntry.performerEntry')}
        </p>
        <div className="public-entry-address">
          {entry.url ? (
            <>
              <bdi dir="ltr" title={entry.url}>
                {entry.url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
              </bdi>
              <button
                type="button"
                className="public-entry-copy pnds-focus-ring"
                disabled={!available}
                aria-label={t('participation.copyEntry')}
                onClick={copyCurrent}
              >
                <Copy aria-hidden="true" />
              </button>
            </>
          ) : (
            <span role="status">
              {t(`participation.publicEntry.${entry.status}`)}
            </span>
          )}
        </div>
        {entry.url && available && (
          <EntryQrImage key={entry.url} url={entry.url} />
        )}
        {!available && entry.url && (
          <p role="alert">{t(`participation.publicEntry.${entry.status}`)}</p>
        )}
      </section>
    )
  return (
    <section
      className="public-entry-details"
      aria-label={t('participation.publicEntry.title')}
    >
      <h3>{t('participation.publicEntry.title')}</h3>
      <p role={entry.status === 'error' ? 'alert' : 'status'}>
        {t(`participation.publicEntry.${entry.status}`)}
      </p>
      {entry.projectName && <p>{entry.projectName}</p>}
      {entry.url && (
        <>
          <p className="host-client-address">
            <bdi dir="ltr">{entry.url}</bdi>
          </p>
          <button
            type="button"
            className="host-client-copy pnds-focus-ring"
            disabled={!available}
            onClick={copyCurrent}
          >
            {t('participation.copyEntry')}
          </button>
        </>
      )}
      {entry.url && available && <EntryQr key={entry.url} url={entry.url} />}
      {diagnostics}
    </section>
  )
}
