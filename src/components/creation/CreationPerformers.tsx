import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreationPerformersStore } from '@/store/creation-performers-store'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { NativeSelect, NativeSelectOption } from '@/components/ui/native-select'
import { Button } from '@/components/ui/button'
import {
  closePerformerWindow,
  configurePerformerWindow,
  focusPerformerWindow,
  openPerformerWindow,
} from '@/lib/performer-window'
import type {
  PerformerDevice,
  PerformerOrientation,
} from '@/lib/performer-protocol'

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
  const [device, setDevice] = useState<PerformerDevice>('phone')
  const [orientation, setOrientation] =
    useState<PerformerOrientation>('portrait')
  const ownsRun =
    !!workspace &&
    (path === workspace.project.root ||
      (runtimeProject?.root === workspace.project.root &&
        runtimeProject.path === path))
  const busy =
    blocked || pending || status === 'starting' || status === 'stopping'
  const choices = (value: PerformerDevice | PerformerOrientation) => (
    <NativeSelectOption value={value}>
      {t(`creation.performers.${value}`)}
    </NativeSelectOption>
  )
  return (
    <section
      aria-label={t('creation.performers.title')}
      className="creation-performers"
    >
      <h3>{t('creation.performers.title')}</h3>
      <div className="flex flex-wrap items-center gap-2">
        <NativeSelect
          aria-label={t('creation.performers.newDevice')}
          value={device}
          disabled={busy}
          onChange={event => setDevice(event.target.value as PerformerDevice)}
        >
          {choices('phone')}
          {choices('tablet')}
        </NativeSelect>
        <NativeSelect
          aria-label={t('creation.performers.newOrientation')}
          value={orientation}
          disabled={busy}
          onChange={event =>
            setOrientation(event.target.value as PerformerOrientation)
          }
        >
          {choices('portrait')}
          {choices('landscape')}
        </NativeSelect>
        <Button
          size="sm"
          variant="outline"
          disabled={busy || status !== 'ready' || !ownsRun}
          onClick={() => {
            void openPerformerWindow(device, orientation)
          }}
        >
          {t('creation.performers.add')}
        </Button>
      </div>
      <p>{t('creation.performers.simulation')}</p>
      {windows.length === 0 ? (
        <p>{t('creation.performers.empty')}</p>
      ) : (
        <ul className="max-h-40 overflow-auto">
          {windows.map(client => (
            <li key={client.label} className="creation-performer-row">
              <span>
                {t('creation.performers.client', { number: client.number })}
              </span>
              <NativeSelect
                aria-label={t('creation.performers.clientDevice', {
                  number: client.number,
                })}
                value={client.device}
                disabled={busy || status !== 'ready'}
                onChange={event => {
                  void configurePerformerWindow(
                    client.label,
                    event.target.value as PerformerDevice,
                    client.orientation
                  )
                }}
              >
                {choices('phone')}
                {choices('tablet')}
              </NativeSelect>
              <NativeSelect
                aria-label={t('creation.performers.clientOrientation', {
                  number: client.number,
                })}
                value={client.orientation}
                disabled={busy || status !== 'ready'}
                onChange={event => {
                  void configurePerformerWindow(
                    client.label,
                    client.device,
                    event.target.value as PerformerOrientation
                  )
                }}
              >
                {choices('portrait')}
                {choices('landscape')}
              </NativeSelect>
              <span role="status">
                {t(`creation.performers.page.${client.pageStatus}`)} ·{' '}
                {t('creation.performers.connectionUnknown')}
              </span>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={t('creation.performers.focusClient', {
                  number: client.number,
                })}
                onClick={() => {
                  void focusPerformerWindow(client.label)
                }}
              >
                {t('creation.performers.focus')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={busy}
                aria-label={t('creation.performers.closeClient', {
                  number: client.number,
                })}
                onClick={() => {
                  void closePerformerWindow(client.label).catch(() => undefined)
                }}
              >
                {t('creation.performers.close')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error && <p role="alert">{error}</p>}
    </section>
  )
}
