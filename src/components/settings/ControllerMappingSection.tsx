import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { commands, type ControllerAddress } from '@/lib/tauri-bindings'
import {
  retryControllerMappingSave,
  updateControllerMapping,
  useControllerMappingStore,
} from '@/store/controller-mapping-store'
import { useSettingsStore } from '@/store/settings-store'
import { SectionTitle } from './SectionTitle'
import { SettingsField } from './SettingsField'
import { SettingsGroup } from './SettingsGroup'
import './controller-mapping-settings.css'

function addressLabel(address: ControllerAddress) {
  return address.sender
    ? `${address.sender} · ${address.address}`
    : address.address
}

export function ControllerMappingSection() {
  const { t } = useTranslation()
  const snapshot = useControllerMappingStore(state => state.snapshot)
  const saveFailed = useControllerMappingStore(state => state.saveFailed)
  const visible = useSettingsStore(
    state => state.settingsOpen && state.focusSection === 'controllerMapping'
  )
  const [portDraft, setPortDraft] = useState<string | null>(null)
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null)
  const [recent, setRecent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const osc = snapshot?.preferences.osc
  const port = portDraft ?? String(osc?.port ?? 9000)
  const enabled = enabledDraft ?? osc?.enabled ?? false

  useEffect(() => {
    if (!visible || !osc?.enabled) return
    let live = true
    const read = () => {
      void commands
        .getControllerOscActivity()
        .then(result => {
          if (live && result.status === 'ok') setRecent(result.data)
        })
        .catch(() => undefined)
    }
    read()
    const watcher = setInterval(read, 400)
    return () => {
      live = false
      clearInterval(watcher)
    }
  }, [visible, osc?.enabled, osc?.port])

  const mappingRows = snapshot?.mappings ?? []
  const scope = snapshot?.scope
  return (
    <section
      id="settings-section-controllerMapping"
      aria-labelledby="settings-controller-mapping-title"
      className="settings-section"
    >
      <SectionTitle id="settings-controller-mapping-title">
        {t('controllerMapping.title')}
      </SectionTitle>

      <form
        onSubmit={async event => {
          event.preventDefault()
          setBusy(true)
          const saved = await updateControllerMapping(
            commands.configureControllerOsc({ enabled, port: Number(port) })
          )
          if (saved) {
            setEnabledDraft(null)
            setPortDraft(null)
            setRecent(null)
          }
          setFailed(!saved)
          setBusy(false)
        }}
      >
        <SettingsGroup
          title={t('controllerMapping.localOsc')}
          description={t('controllerMapping.localAddress')}
          footer={
            <Button type="submit" disabled={busy || !snapshot}>
              {t('controllerMapping.apply')}
            </Button>
          }
        >
          <SettingsField
            label={t('controllerMapping.oscEnabled')}
            htmlFor="controller-osc-enabled"
          >
            <Switch
              id="controller-osc-enabled"
              checked={enabled}
              onCheckedChange={setEnabledDraft}
              disabled={busy}
            />
          </SettingsField>
          <SettingsField
            label={t('controllerMapping.receivePort')}
            htmlFor="controller-osc-port"
          >
            <Input
              id="controller-osc-port"
              type="number"
              inputMode="numeric"
              min={1}
              max={65535}
              required
              value={port}
              disabled={busy}
              onChange={event => setPortDraft(event.currentTarget.value)}
            />
          </SettingsField>
          <SettingsField label={t('controllerMapping.recentInput')}>
            <output>{(osc?.enabled && recent) || '—'}</output>
          </SettingsField>
          {(failed || snapshot?.oscError) && (
            <p role="alert" className="settings-helper-text">
              {t('controllerMapping.oscFailed')}
            </p>
          )}
        </SettingsGroup>
      </form>

      <SettingsGroup
        title={t('controllerMapping.mappings')}
        description={scope?.name}
      >
        {mappingRows.length ? (
          <ul className="controller-mapping-list">
            {mappingRows.map(mapping => (
              <li key={mapping.target.id} className="controller-mapping-row">
                <div>
                  <div>
                    {mapping.target.name ||
                      t('controllerMapping.unnamedControl')}
                  </div>
                  <code dir="ltr">{addressLabel(mapping.address)}</code>
                  {mapping.target.temporary && (
                    <small>{t('controllerMapping.temporary')}</small>
                  )}
                  {snapshot?.unavailable.includes(mapping.target.id) && (
                    <small>{t('controllerMapping.rebind')}</small>
                  )}
                </div>
                {scope && (
                  <Button
                    type="button"
                    variant="outline"
                    aria-label={t('controllerMapping.removeTarget', {
                      name:
                        mapping.target.name || addressLabel(mapping.address),
                    })}
                    onClick={() => {
                      void updateControllerMapping(
                        commands.removeControllerMapping(
                          scope.key,
                          mapping.target.id
                        )
                      )
                    }}
                  >
                    {t('controllerMapping.remove')}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        ) : (
          <p className="settings-helper-text">{t('controllerMapping.empty')}</p>
        )}
        {saveFailed && (
          <div role="alert">
            <p>{t('controllerMapping.saveFailed')}</p>
            <Button variant="outline" onClick={retryControllerMappingSave}>
              {t('error.retry')}
            </Button>
          </div>
        )}
      </SettingsGroup>
    </section>
  )
}
