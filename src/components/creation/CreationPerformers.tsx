import { useTranslation } from 'react-i18next'
import { Plus, Smartphone, Tablet, X } from 'lucide-react'
import { useCreationPerformersStore } from '@/store/creation-performers-store'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import {
  closePerformerWindow,
  configurePerformerWindow,
  focusPerformerWindow,
  openPerformerWindow,
} from '@/lib/performer-window'

export function CreationPerformers() {
  const { t } = useTranslation()
  const windows = useCreationPerformersStore(state => state.windows)
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
        <span className="creation-performer-count">{windows.length}</span>
      </header>
      {windows.length === 0 ? (
        <p className="creation-performer-empty">
          {t('creation.performers.empty')}
        </p>
      ) : (
        <ul className="creation-performer-list">
          {windows.map(client => {
            const Device = client.device === 'phone' ? Smartphone : Tablet
            return (
              <li key={client.label} className="creation-performer-row">
                <Device
                  aria-hidden="true"
                  data-orientation={client.orientation}
                  className="creation-performer-icon"
                />
                <div className="creation-performer-info">
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
                    {t('creation.performers.client', { number: client.number })}
                  </button>
                  <span>
                    {t(`creation.performers.${client.device}`)} ·{' '}
                    {t(`creation.performers.${client.orientation}`)}
                  </span>
                  <label className="creation-performer-input">
                    <input
                      type="checkbox"
                      checked={client.mouseTouch}
                      disabled={busy || status !== 'ready'}
                      onChange={event => {
                        void configurePerformerWindow(
                          client.label,
                          client.device,
                          client.orientation,
                          event.target.checked
                        )
                      }}
                    />
                    {t('creation.performers.mouseTouch')}
                  </label>
                </div>
                <span
                  role="status"
                  className="creation-performer-status"
                  title={t(`creation.performers.page.${client.pageStatus}`)}
                >
                  <i aria-hidden="true" />
                  {t('creation.performers.connectionUnknown')}
                  <span className="sr-only">
                    {' '}
                    · {t(`creation.performers.page.${client.pageStatus}`)}
                  </span>
                </span>
                <button
                  className="creation-icon-button pnds-focus-ring"
                  disabled={busy}
                  aria-label={t('creation.performers.closeClient', {
                    number: client.number,
                  })}
                  title={t('creation.performers.closeClient', {
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
              </li>
            )
          })}
        </ul>
      )}
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
