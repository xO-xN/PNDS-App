import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { updatePreferences } from '@/lib/preferences'
import { useSettingsStore } from '@/store/settings-store'
import { PerformanceRoleButton } from './PerformanceRoleButton'
import { TrafficLights } from './TrafficLights'

/** Host identity is named in place before exposing the project library. */
export function HostNodeSetupSidebar() {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [failed, setFailed] = useState(false)
  const pending = useRef(false)
  return (
    <aside className="host-setup-sidebar">
      <div data-tauri-drag-region className="desktop-sidebar-chrome">
        <TrafficLights />
      </div>
      <div className="performance-sidebar-identity">
        <PerformanceRoleButton />
      </div>
      <div className="participation-sidebar-content">
        <form
          onSubmit={event => {
            event.preventDefault()
            const trimmed = name.trim()
            if (!trimmed || pending.current) return
            pending.current = true
            setSaving(true)
            setFailed(false)
            void updatePreferences({ nodeName: trimmed }).then(saved => {
              pending.current = false
              setSaving(false)
              if (saved) {
                useSettingsStore.getState().setNodeNameSetting(trimmed)
              } else setFailed(true)
            })
          }}
        >
          <div className="participation-side-heading">
            <h2>{t('participation.ui.nameSetupTitle')}</h2>
            <p>{t('participation.ui.nameSetupHelp')}</p>
          </div>
          <label className="participation-field-label" htmlFor="host-node-name">
            {t('settings.nodeName')}
          </label>
          <input
            id="host-node-name"
            className="participation-address pnds-focus-ring"
            value={name}
            onChange={event => setName(event.target.value)}
            placeholder={t('participation.ui.namePlaceholder')}
            autoComplete="off"
            spellCheck={false}
            required
            disabled={saving}
          />
          <p className="participation-field-help">
            {t('participation.ui.nameRequired')}
          </p>
          {failed && (
            <p role="alert" className="host-name-error">
              {t('participation.ui.nameSaveFailed')}
            </p>
          )}
          <button
            type="submit"
            disabled={saving || !name.trim()}
            className="participation-button participation-button--primary participation-button--wide pnds-focus-ring"
          >
            {t('participation.ui.nameSave')}
          </button>
        </form>
      </div>
      <div className="desktop-sidebar-footer">
        {t('participation.ui.unnamedHost')}
      </div>
    </aside>
  )
}
