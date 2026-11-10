import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { notifications } from '@/lib/notifications'
import { LoaderCircle, Monitor, Server, X } from 'lucide-react'
import type {
  ClientError,
  ClientHostInfo,
  ClientSnapshot,
} from '@/lib/tauri-bindings'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import {
  useClientParticipationStore,
  clientParticipationActive,
} from '@/store/client-participation-store'
import {
  isSessionLive,
  isSessionBusy,
  useSessionStore,
} from '@/store/session-store'
import pndsIcon from '@/assets/pnds-icon.png'
import { TrafficLights } from './TrafficLights'
import { PerformanceRoleButton } from './PerformanceRoleButton'
import { ClientScoreView } from './ClientScoreView'

function PerformanceWelcome({ role }: { role: 'host' | 'client' | null }) {
  const { t } = useTranslation()
  return (
    <section
      className="participation-welcome"
      aria-labelledby="participation-welcome-heading"
    >
      <div className="participation-logo-stage" aria-hidden="true">
        <img src={pndsIcon} alt="" width={72} height={72} draggable={false} />
      </div>
      <div className="participation-product-name">PNDS</div>
      <p>{t('welcome.subtitle')}</p>
      <h1 id="participation-welcome-heading">
        {t(`participation.ui.${role ? `${role}Welcome` : 'chooseToContinue'}`)}
      </h1>
      <p>
        {t(`participation.ui.${role ? `${role}WelcomeHelp` : 'chooseHelp'}`)}
      </p>
      {!role && (
        <p className="participation-entry-note">
          {t('participation.ui.entryHelp')}
        </p>
      )}
    </section>
  )
}

/** The approved entry welcome shares the same reading geometry as Client notices. */
export function EntryPerformanceWelcome({
  role = null,
}: {
  role?: 'host' | 'client' | null
}) {
  return (
    <main className="participation-main participation-main--reading">
      <PerformanceWelcome role={role} />
    </main>
  )
}

function ParticipationFailure({ failure }: { failure: ClientError | null }) {
  const { t } = useTranslation()
  if (!failure) return null
  return (
    <div className="participation-failure">
      <p role="alert">{t(failure.code)}</p>
      {failure.detail && (
        <details>
          <summary>{t('participation.errorDetails')}</summary>
          <pre>{failure.detail}</pre>
        </details>
      )}
    </div>
  )
}

function candidateKey(host: ClientHostInfo | null): string {
  return JSON.stringify([
    host?.hostId,
    host?.performance?.projectId,
    host?.performance?.performanceId,
  ])
}

function ClientConnection({ snapshot }: { snapshot: ClientSnapshot }) {
  const { t } = useTranslation()
  const statusKey = {
    idle: 'participation.ui.notConnected',
    inspecting: 'participation.phase.inspecting',
    confirm: 'participation.ui.confirmTitle',
    connecting: 'participation.phase.connecting',
    open: 'participation.ui.openedUnknown',
    disconnected: 'participation.ui.disconnected',
    ended: 'participation.ui.endedTitle',
    changed:
      snapshot.expectedHostId &&
      snapshot.host?.hostId !== snapshot.expectedHostId
        ? 'participation.ui.hostChangedTitle'
        : 'participation.ui.changedTitle',
    leaving: 'participation.phase.leaving',
    cleanupFailed: 'participation.ui.cleanupFailedTitle',
    error: 'participation.ui.failedTitle',
  }[snapshot.phase]
  return (
    <>
      <div className="participation-connection-box">
        <span className="participation-status-pill">
          <i aria-hidden="true" />
          {t(statusKey)}
        </span>
        <h3>
          {snapshot.host?.nodeName ?? t('participation.ui.hostConnection')}
        </h3>
        {snapshot.address && (
          <p>
            <bdi dir="ltr">{snapshot.address}</bdi>
          </p>
        )}
      </div>
      {snapshot.host && (
        <dl className="participation-details">
          <dt>{t('participation.ui.currentPerformance')}</dt>
          <dd>
            {snapshot.host.performance?.projectName ??
              t('participation.noPerformance')}
          </dd>
        </dl>
      )}
      {snapshot.phase === 'open' && (
        <p className="participation-status-message">
          {t('participation.acceptanceUnknown')}
        </p>
      )}
      {snapshot.phase === 'disconnected' && (
        <p className="participation-status-message">
          {t('participation.ui.disconnectedHelp')}
        </p>
      )}
      {snapshot.phase === 'connecting' && (
        <p className="participation-status-message" role="status">
          {t('participation.ui.connectingHelp')}
        </p>
      )}
      {snapshot.pageUrl &&
        snapshot.phase === 'changed' &&
        snapshot.host?.performance?.supportsPerformerUrl && (
          <button
            key={candidateKey(snapshot.host)}
            type="button"
            className="participation-button participation-button--primary participation-button--wide participation-connection-action pnds-focus-ring"
            onClick={() => {
              if (snapshot.host)
                void useClientParticipationStore.getState().join(snapshot.host)
            }}
          >
            {t(
              snapshot.expectedHostId &&
                snapshot.host.hostId !== snapshot.expectedHostId
                ? 'participation.ui.joinDifferentHost'
                : 'participation.join'
            )}
          </button>
        )}
      {snapshot.pageUrl && <ClientRefreshButton />}
      <button
        type="button"
        className="participation-button participation-button--quiet participation-button--wide participation-connection-action pnds-focus-ring"
        disabled={snapshot.phase === 'leaving'}
        onClick={() => {
          const current = useClientParticipationStore.getState()
          if (snapshot.phase === 'connecting') void current.cancelEntry()
          else void current.leave()
        }}
      >
        {t(
          snapshot.phase === 'cleanupFailed'
            ? 'participation.ui.retryLeave'
            : snapshot.phase === 'inspecting' || snapshot.phase === 'connecting'
              ? 'participation.cancel'
              : clientParticipationActive(snapshot)
                ? 'participation.leave'
                : 'participation.ui.backConnections'
        )}
      </button>
    </>
  )
}

export function ParticipationSidebar() {
  const { t } = useTranslation()
  const hostBusy = useSessionStore(
    state =>
      isSessionLive(state.sessionStatus) ||
      isSessionBusy(state.sessionStatus) ||
      state.commandPending
  )
  const role = usePerformanceRoleStore(state => state.role)
  const snapshot = useClientParticipationStore(state => state.snapshot)
  const address = useClientParticipationStore(state => state.address)
  const recent = useClientParticipationStore(state => state.recentHosts)
  const error = useClientParticipationStore(state => state.error)
  const persistenceError = useClientParticipationStore(
    state => state.persistenceError
  )
  const failure = error ?? snapshot.error
  return (
    <aside
      data-testid="participation-sidebar"
      data-sidebar-surface=""
      className="participation-sidebar"
      aria-label={t('participation.ui.sidebarLabel')}
    >
      <div data-tauri-drag-region className="desktop-sidebar-chrome">
        <TrafficLights />
      </div>
      {role && (
        <div className="performance-sidebar-identity">
          <PerformanceRoleButton />
        </div>
      )}
      <div className="participation-sidebar-content">
        {!role && (
          <>
            <div className="participation-side-heading">
              <h2>{t('participation.ui.chooseHeading')}</h2>
              <p>{t('participation.ui.chooseHelp')}</p>
            </div>
            <div className="participation-role-choices">
              {(['host', 'client'] as const).map(choice => {
                const Icon = choice === 'host' ? Server : Monitor
                return (
                  <button
                    key={choice}
                    type="button"
                    className="participation-role-card pnds-focus-ring"
                    aria-label={t(`participation.${choice}`)}
                    aria-describedby={`participation-${choice}-description`}
                    disabled={choice === 'client' && hostBusy}
                    onClick={() => {
                      void usePerformanceRoleStore
                        .getState()
                        .commitRole(choice)
                        .then(saved => {
                          if (!saved)
                            notifications.error(
                              t('participation.roleMemorySaveFailed')
                            )
                        })
                    }}
                  >
                    <Icon aria-hidden="true" />
                    <span>
                      <span className="participation-role-title">
                        {t(`participation.${choice}`)}
                      </span>
                      <span
                        id={`participation-${choice}-description`}
                        className="participation-role-description"
                      >
                        {t(`participation.ui.${choice}Description`)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          </>
        )}
        {role === 'client' && (
          <>
            {snapshot.phase === 'idle' ? (
              <>
                <form
                  onSubmit={event => {
                    event.preventDefault()
                    void useClientParticipationStore.getState().inspect()
                  }}
                >
                  <label
                    htmlFor="client-host-address"
                    className="participation-field-label"
                  >
                    {t('participation.address')}
                  </label>
                  <input
                    id="client-host-address"
                    dir="ltr"
                    type="url"
                    autoComplete="off"
                    required
                    value={address}
                    placeholder={t('participation.ui.addressPlaceholder')}
                    className="participation-address pnds-focus-ring"
                    aria-describedby="client-address-help"
                    onChange={event =>
                      useClientParticipationStore
                        .getState()
                        .setAddress(event.target.value)
                    }
                  />
                  <p
                    id="client-address-help"
                    className="participation-field-help"
                  >
                    {t('participation.ui.addressHint')}
                  </p>
                  <button
                    type="submit"
                    disabled={!address.trim()}
                    className="participation-button participation-button--primary participation-button--wide pnds-focus-ring"
                  >
                    {t('participation.inspect')}
                  </button>
                </form>
                <section
                  className="participation-recents"
                  aria-labelledby="client-recent-heading"
                >
                  <h2
                    id="client-recent-heading"
                    className="participation-section-label"
                  >
                    {t('participation.recent')}
                  </h2>
                  {recent.length ? (
                    recent.map(host => (
                      <div
                        key={host.hostId}
                        className="participation-recent-row"
                      >
                        <button
                          type="button"
                          className="participation-recent-open pnds-focus-ring"
                          aria-label={t('participation.ui.useHost', {
                            host: host.nodeName,
                          })}
                          onClick={() => {
                            useClientParticipationStore
                              .getState()
                              .setAddress(host.address)
                            void useClientParticipationStore
                              .getState()
                              .inspect(host.hostId)
                          }}
                        >
                          <strong>{host.nodeName}</strong>
                          <bdi dir="ltr">{host.address}</bdi>
                        </button>
                        <button
                          type="button"
                          className="participation-recent-forget pnds-focus-ring"
                          aria-label={t('participation.ui.forgetHost', {
                            host: host.nodeName,
                          })}
                          onClick={() =>
                            void useClientParticipationStore
                              .getState()
                              .forgetRecentHost(host.hostId)
                          }
                        >
                          <X aria-hidden="true" />
                        </button>
                      </div>
                    ))
                  ) : (
                    <p className="participation-caption">
                      {t('participation.ui.noRecent')}
                    </p>
                  )}
                </section>
              </>
            ) : (
              <ClientConnection snapshot={snapshot} />
            )}
            <ParticipationFailure failure={failure} />
            {persistenceError && (
              <p role="alert" className="participation-status-message">
                {t('participation.recentSaveFailed')}
              </p>
            )}
          </>
        )}
      </div>
      <div className="participation-sidebar-foot">
        {t(
          role === 'client'
            ? snapshot.phase === 'idle'
              ? 'participation.ui.notConnected'
              : 'participation.ui.connection'
            : 'participation.ui.role'
        )}
      </div>
    </aside>
  )
}

type Notice =
  | 'confirm'
  | 'hostChanged'
  | 'changed'
  | 'ended'
  | 'projectIncompatible'
  | 'incompatible'
  | 'invalidMetadata'
  | 'unreachable'
  | 'cleanupFailed'
  | 'failed'

function clientNotice(
  snapshot: ClientSnapshot,
  failure: ClientError | null
): Notice | null {
  if (snapshot.phase === 'cleanupFailed') return 'cleanupFailed'
  if (failure?.code === 'participation.errors.incompatible')
    return 'incompatible'
  if (failure?.code === 'participation.errors.invalidMetadata')
    return 'invalidMetadata'
  if (
    failure?.code === 'participation.errors.adaptation' ||
    snapshot.host?.performance?.supportsPerformerUrl === false
  )
    return 'projectIncompatible'
  if (
    (snapshot.phase === 'confirm' || snapshot.phase === 'changed') &&
    snapshot.expectedHostId &&
    snapshot.host?.hostId !== snapshot.expectedHostId
  )
    return 'hostChanged'
  if (
    snapshot.phase === 'changed' ||
    failure?.code === 'participation.errors.changed'
  )
    return 'changed'
  if (snapshot.phase === 'ended') return 'ended'
  if (failure?.code === 'participation.errors.unavailable') return 'unreachable'
  if (snapshot.phase === 'confirm') {
    if (!snapshot.host?.performance) return 'ended'
    return 'confirm'
  }
  if (failure || snapshot.phase === 'error') return 'failed'
  return null
}

function ClientNotice({
  snapshot,
  notice,
}: {
  snapshot: ClientSnapshot
  notice: Notice
}) {
  const { t } = useTranslation()
  const recent = useClientParticipationStore(state => state.recentHosts)
  const expectedHost = recent.find(
    host => host.hostId === snapshot.expectedHostId
  )
  const canJoin =
    (snapshot.phase === 'confirm' || snapshot.phase === 'changed') &&
    snapshot.host?.performance?.supportsPerformerUrl === true &&
    (notice === 'confirm' || notice === 'hostChanged' || notice === 'changed')
  const inspect = () => {
    const current = useClientParticipationStore.getState()
    if (snapshot.address) current.setAddress(snapshot.address)
    void current.inspect(snapshot.expectedHostId ?? snapshot.host?.hostId)
  }
  return (
    <section
      className="participation-notice"
      aria-labelledby="client-notice-heading"
    >
      {snapshot.host && (
        <span className="participation-status-pill">
          {snapshot.host.nodeName}
        </span>
      )}
      <h1 id="client-notice-heading">{t(`participation.ui.${notice}Title`)}</h1>
      <p>{t(`participation.ui.${notice}Help`)}</p>
      {(snapshot.host || snapshot.address) && (
        <dl className="participation-details">
          {notice === 'hostChanged' && expectedHost && (
            <>
              <dt>{t('participation.ui.expectedHost')}</dt>
              <dd>{expectedHost.nodeName}</dd>
            </>
          )}
          {snapshot.host && (
            <>
              <dt>
                {t(
                  notice === 'hostChanged'
                    ? 'participation.ui.actualHost'
                    : 'participation.ui.hostName'
                )}
              </dt>
              <dd>{snapshot.host.nodeName}</dd>
            </>
          )}
          {snapshot.host?.performance && (
            <>
              <dt>{t('participation.ui.currentPerformance')}</dt>
              <dd>{snapshot.host.performance.projectName}</dd>
            </>
          )}
          {snapshot.address && (
            <>
              <dt>{t('participation.address')}</dt>
              <dd>
                <bdi dir="ltr">{snapshot.address}</bdi>
              </dd>
            </>
          )}
        </dl>
      )}
      <div className="participation-notice-actions">
        {notice === 'cleanupFailed' ? (
          <button
            type="button"
            className="participation-button participation-button--primary pnds-focus-ring"
            onClick={() => void useClientParticipationStore.getState().leave()}
          >
            {t('participation.ui.retryLeave')}
          </button>
        ) : (
          <>
            <button
              type="button"
              className="participation-button participation-button--primary pnds-focus-ring"
              key={candidateKey(snapshot.host)}
              onClick={
                canJoin
                  ? () => {
                      if (snapshot.host)
                        void useClientParticipationStore
                          .getState()
                          .join(snapshot.host)
                    }
                  : inspect
              }
            >
              {t(
                canJoin
                  ? notice === 'hostChanged'
                    ? 'participation.ui.joinDifferentHost'
                    : 'participation.join'
                  : notice === 'changed' || notice === 'ended'
                    ? 'participation.ui.checkAgain'
                    : 'participation.ui.retry'
              )}
            </button>
            <button
              type="button"
              className="participation-button participation-button--quiet pnds-focus-ring"
              onClick={() =>
                void useClientParticipationStore.getState().leave()
              }
            >
              {t('participation.ui.backConnections')}
            </button>
          </>
        )}
      </div>
    </section>
  )
}

export function ClientParticipationView() {
  const { t } = useTranslation()
  const snapshot = useClientParticipationStore(state => state.snapshot)
  const error = useClientParticipationStore(state => state.error)
  const notice = clientNotice(snapshot, error ?? snapshot.error)
  const busy =
    snapshot.phase === 'inspecting' ||
    snapshot.phase === 'connecting' ||
    snapshot.phase === 'leaving'
  return (
    <main
      className={`participation-main ${snapshot.pageUrl ? 'participation-main--live' : 'participation-main--reading'}`}
    >
      {snapshot.pageUrl ? (
        <ClientScoreView key={snapshot.pageUrl} pageUrl={snapshot.pageUrl} />
      ) : busy ? (
        <section className="participation-connecting" role="status">
          <LoaderCircle aria-hidden="true" />
          <h1>{t(`participation.phase.${snapshot.phase}`)}</h1>
          <p>{t(`participation.ui.${snapshot.phase}Help`)}</p>
        </section>
      ) : notice ? (
        <ClientNotice snapshot={snapshot} notice={notice} />
      ) : (
        <PerformanceWelcome role="client" />
      )}
    </main>
  )
}

function ClientRefreshButton() {
  const { t } = useTranslation()
  const snapshot = useClientParticipationStore(state => state.snapshot)
  const [armedPage, setArmedPage] = useState<string | null>(null)
  const root = useRef<HTMLButtonElement>(null)
  useEffect(() => {
    const cancel = () => setArmedPage(null)
    const key = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancel()
    }
    const outside = (event: PointerEvent) => {
      if (
        !(event.target instanceof Node) ||
        !root.current?.contains(event.target)
      )
        cancel()
    }
    window.addEventListener('blur', cancel)
    window.addEventListener('pointerdown', outside)
    window.addEventListener('keydown', key)
    return () => {
      window.removeEventListener('blur', cancel)
      window.removeEventListener('pointerdown', outside)
      window.removeEventListener('keydown', key)
    }
  }, [])
  const canRefresh =
    !!snapshot.pageUrl &&
    snapshot.phase !== 'connecting' &&
    snapshot.phase !== 'leaving' &&
    snapshot.phase !== 'cleanupFailed'
  const armed = canRefresh && armedPage === snapshot.pageUrl
  const label = t(
    armed ? 'participation.confirmRefresh' : 'participation.refresh'
  )
  return (
    <button
      ref={root}
      type="button"
      className="participation-button participation-button--primary participation-button--wide participation-connection-action pnds-focus-ring"
      disabled={!canRefresh}
      data-armed={armed}
      aria-label={label}
      aria-pressed={armed}
      onBlur={() => setArmedPage(null)}
      onClick={() => {
        if (armed) {
          setArmedPage(null)
          void useClientParticipationStore.getState().refresh()
        } else setArmedPage(snapshot.pageUrl)
      }}
    >
      <span>{label}</span>
    </button>
  )
}
