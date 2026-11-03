import { TooltipHint } from '@/components/ui/tooltip'
import { useTranslation } from 'react-i18next'
import { Eye, EyeOff, Plus, Smartphone, Tablet, X } from 'lucide-react'
import { useCreationPerformersStore } from '@/store/creation-performers-store'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { PerformerQrButton } from '@/components/qr/PerformerQr'
import {
  closePerformerWindow,
  focusPerformerWindow,
  setPerformerWindowVisible,
  openPerformerWindow,
} from '@/lib/performer-window'

export function CreationPerformers() {
  const { t } = useTranslation()
  const windows = useCreationPerformersStore(state => state.windows)
  const connections = useCreationPerformersStore(state => state.connections)
  const connectionStatus = useCreationPerformersStore(
    state => state.connectionStatus
  )
  const external =
    connections?.clients.filter(
      client => !windows.some(window => window.label === client.testClient)
    ) ?? []
  const error = useCreationPerformersStore(state => state.error)
  const workspace = useCreationStore(state => state.workspace)
  const runtimeProject = useCreationStore(state => state.runtimeProject)
  const blocked = useCreationStore(
    state => state.opening || state.modePhase !== 'idle'
  )
  const pending = useSessionStore(state => state.commandPending)
  const status = useSessionStore(state => state.sessionStatus)
  const path = useSessionStore(state => state.sessionProjectPath)
  const ownsRun =
    !!workspace &&
    (path === workspace.project.root ||
      (runtimeProject?.root === workspace.project.root &&
        runtimeProject.path === path))
  const busy =
    blocked || pending || status === 'starting' || status === 'stopping'
  return (
    <section
      aria-label={t('creation.performers.title')}
      className="creation-performers"
    >
      <header>
        <h3>{t('creation.performers.title')}</h3>
        <span className="creation-performer-count">
          {windows.length + external.length}
        </span>
        <PerformerQrButton
          compact
          disabled={busy || !ownsRun}
          className="creation-icon-button pnds-focus-ring"
        />
      </header>
      {windows.length === 0 ? (
        <p className="creation-performer-empty">
          {t('creation.performers.empty')}
        </p>
      ) : (
        <ul className="creation-performer-list">
          {windows.map(client => {
            const Device = client.device === 'phone' ? Smartphone : Tablet
            const joined = connections?.clients.some(
              row => row.testClient === client.label
            )
            const connectionLabel = t(
              connectionStatus !== 'available'
                ? 'creation.performers.connectionUnknown'
                : joined
                  ? 'creation.performers.connected'
                  : 'creation.performers.notJoined'
            )
            return (
              <li key={client.label} className="creation-performer-row">
                <Device
                  aria-hidden="true"
                  data-orientation={client.orientation}
                  className="creation-performer-icon"
                />
                <div className="creation-performer-info">
                  <TooltipHint content={t('creation.performers.focusHint')}>
                    <button
                      className="pnds-focus-ring"
                      disabled={busy}
                      aria-label={t('creation.performers.focusClient', {
                        number: client.number,
                      })}
                      onClick={() => {
                        void focusPerformerWindow(client.label)
                      }}
                    >
                      {t('creation.performers.client', {
                        number: client.number,
                      })}
                    </button>
                  </TooltipHint>
                  <span>
                    {t('creation.performers.virtual')} ·{' '}
                    {t(`creation.performers.${client.device}`)} ·{' '}
                    {t(`creation.performers.${client.orientation}`)}
                  </span>
                </div>
                <TooltipHint
                  content={`${t(`creation.performers.page.${client.pageStatus}`)} · ${t('creation.performers.connectionHint')}`}
                >
                  <span
                    role="status"
                    tabIndex={0}
                    className="creation-performer-status pnds-focus-ring"
                  >
                    <i aria-hidden="true" />
                    {client.pageStatus === 'loaded'
                      ? connectionLabel
                      : t(`creation.performers.page.${client.pageStatus}`)}
                  </span>
                </TooltipHint>
                <TooltipHint
                  content={t(
                    client.visible
                      ? 'creation.performers.hideHint'
                      : 'creation.performers.showHint'
                  )}
                >
                  <button
                    className="creation-icon-button pnds-focus-ring"
                    disabled={busy || client.disposing}
                    aria-label={t(
                      client.visible
                        ? 'creation.performers.hideClient'
                        : 'creation.performers.showClient',
                      { number: client.number }
                    )}
                    aria-pressed={client.visible}
                    onClick={() => {
                      void setPerformerWindowVisible(
                        client.label,
                        !client.visible
                      )
                    }}
                  >
                    {client.visible ? (
                      <EyeOff aria-hidden="true" />
                    ) : (
                      <Eye aria-hidden="true" />
                    )}
                  </button>
                </TooltipHint>
                <TooltipHint content={t('creation.performers.closeHint')}>
                  <button
                    className="creation-icon-button pnds-focus-ring"
                    disabled={busy}
                    aria-label={t('creation.performers.deleteClient', {
                      number: client.number,
                    })}
                    onClick={() => {
                      void closePerformerWindow(client.label).catch(
                        () => undefined
                      )
                    }}
                  >
                    <X aria-hidden="true" />
                  </button>
                </TooltipHint>
              </li>
            )
          })}
        </ul>
      )}
      {external.length > 0 && (
        <ul
          className="creation-performer-list"
          aria-label={t('creation.performers.external')}
        >
          {external.map(client => (
            <li key={client.id} className="creation-performer-row">
              <Smartphone
                aria-hidden="true"
                className="creation-performer-icon"
              />
              <div className="creation-performer-info">
                <strong>{client.label}</strong>
                <span>
                  {t(
                    client.testClient
                      ? 'creation.performers.otherTest'
                      : 'creation.performers.external'
                  )}
                </span>
              </div>
              <span className="creation-performer-status">
                <i aria-hidden="true" />
                {t('creation.performers.connected')}
              </span>
            </li>
          ))}
        </ul>
      )}
      <p className="creation-performer-roster" aria-live="polite">
        {t(`creation.performers.roster.${connectionStatus}`)}
      </p>
      <button
        className="creation-performer-add pnds-focus-ring"
        disabled={busy || status !== 'ready' || !ownsRun}
        onClick={() => {
          void openPerformerWindow('phone', 'portrait')
        }}
      >
        <Plus aria-hidden="true" />
        {t('creation.performers.add')}
      </button>
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
