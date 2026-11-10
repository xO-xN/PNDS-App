import { useEffect, useState } from 'react'
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

function EntryQrImage({ url }: { url: string }) {
  const { t } = useTranslation()
  const [image, setImage] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let active = true
    void commands
      .getHostEntryQr(url)
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
  }, [url, attempt])
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
      alt={t('participation.publicEntry.qrAlt')}
    />
  ) : (
    <p role="status">{t('participation.publicEntry.qrPreparing')}</p>
  )
}

/** Display only facts from the held native listener; opening this is read-only. */
export function PublicEntryDetails({ compact = false }: { compact?: boolean }) {
  const { t } = useTranslation()
  const entry = useHostEntryStore(state => state.snapshot)
  const status = useSessionStore(state => state.sessionStatus)
  const snapshot = useSessionStore(state => state.latestSnapshot)
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
      {(entry.url || live || entry.error) && (
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
    </section>
  )
}
