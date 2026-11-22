import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { commands, type ControllerAddress } from '@/lib/tauri-bindings'
import {
  retryControllerMappingSave,
  updateControllerMapping,
  useControllerMappingStore,
} from '@/store/controller-mapping-store'
import { ControllerMappingRangeFields } from './ControllerMappingRangeFields'
import { ControllerOscInputSettings } from './ControllerOscInputSettings'
import { SectionTitle } from './SectionTitle'
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

      <ControllerOscInputSettings />

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
