import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { commands, type ControllerAddress } from '@/lib/tauri-bindings'
import {
  retryControllerMappingSave,
  updateControllerMapping,
  useControllerMappingStore,
} from '@/store/controller-mapping-store'
import { useSettingsStore } from '@/store/settings-store'
import { SectionTitle } from './SectionTitle'
import { ControllerDeclaredTargets } from './ControllerDeclaredTargets'
import { ControllerMappingRangeFields } from './ControllerMappingRangeFields'
import { ControllerMidiSettings } from './ControllerMidiSettings'
import { ControllerOscInputSettings } from './ControllerOscInputSettings'
import { useControllerMidiPorts } from '@/hooks/use-controller-midi-ports'
import { SettingsField } from './SettingsField'
import { SettingsGroup } from './SettingsGroup'
import './controller-mapping-settings.css'

export function ControllerMappingSection() {
  const { t } = useTranslation()
  const [selection, setSelection] = useState<{
    page: number | null
    key: string
  } | null>(null)
  const snapshot = useControllerMappingStore(state => state.snapshot)
  const saveFailed = useControllerMappingStore(state => state.saveFailed)
  const visible = useSettingsStore(
    state => state.settingsOpen && state.focusSection === 'controllerMapping'
  )
  const { ports: midiPorts, failed: midiReadFailed } =
    useControllerMidiPorts(visible)

  const addressLabel = (address: ControllerAddress) => {
    if (address.kind !== 'osc') {
      const port = midiPorts?.find(port => port.id === address.port)
      const message = t(
        address.kind === 'midiCc'
          ? 'controllerMapping.midiCc'
          : 'controllerMapping.midiNote',
        address
      )
      return `${port?.name ?? address.port} · ${message}`
    }
    return address.sender
      ? `${address.sender} · ${address.address}`
      : address.address
  }

  const activeScope = snapshot?.scope
  const page = snapshot?.page ?? null
  const groups = snapshot?.preferences.groups ?? []
  const savedScopes = groups
    .map(group => group.scope)
    .filter(scope => scope.key !== activeScope?.key)
  const scopes = activeScope ? [activeScope, ...savedScopes] : savedScopes
  const scope =
    (selection?.page === page
      ? scopes.find(scope => scope.key === selection.key)
      : undefined) ?? scopes[0]
  const active = scope != null && scope.key === activeScope?.key
  const mappingRows = active
    ? (snapshot?.mappings ?? [])
    : (groups.find(group => group.scope.key === scope?.key)?.mappings ?? [])
  return (
    <section
      id="settings-section-controllerMapping"
      aria-labelledby="settings-controller-mapping-title"
      className="settings-section"
    >
      <SectionTitle id="settings-controller-mapping-title">
        {t('controllerMapping.title')}
      </SectionTitle>

      <ControllerMidiSettings
        ports={midiPorts}
        readFailed={midiReadFailed}
        enabledPorts={snapshot?.preferences.midiPorts ?? []}
      />

      <ControllerOscInputSettings />

      {active && page != null && !!snapshot?.declaredTargets?.length && (
        <ControllerDeclaredTargets
          key={page}
          page={page}
          targets={snapshot.declaredTargets}
          pending={snapshot.pending?.id}
        />
      )}

      <SettingsGroup title={t('controllerMapping.mappings')}>
        {scope && (
          <SettingsField
            label={t('controllerMapping.projectAndRole')}
            htmlFor="controller-mapping-project"
          >
            <Select
              value={scope.key}
              onValueChange={key => setSelection({ page, key })}
            >
              <SelectTrigger
                id="controller-mapping-project"
                className="max-w-[18rem]"
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent className="max-w-[min(28rem,90vw)]">
                {scopes.map(option => {
                  const duplicate = scopes.some(
                    other =>
                      other.key !== option.key &&
                      other.name === option.name &&
                      other.role === option.role
                  )
                  const name = duplicate
                    ? `${option.name} (${option.key.replace(/^(?:host|client):/, '')})`
                    : option.name
                  return (
                    <SelectItem key={option.key} value={option.key}>
                      {t('controllerMapping.scopeLabel', {
                        name,
                        role: t(`participation.${option.role}`),
                      })}
                    </SelectItem>
                  )
                })}
              </SelectContent>
            </Select>
          </SettingsField>
        )}
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
                  {active &&
                    snapshot?.unavailable.includes(mapping.target.id) && (
                      <small>{t('controllerMapping.rebind')}</small>
                    )}
                  {scope && mapping.range && (
                    <ControllerMappingRangeFields
                      key={scope.key}
                      scope={scope.key}
                      mapping={mapping}
                      range={mapping.range}
                    />
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
