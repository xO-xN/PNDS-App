import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { normalizeNodeName, updatePreferences } from '@/lib/preferences'
import { useSettingsStore } from '@/store/settings-store'
import { SettingsField } from './SettingsField'
import { SettingsGroup } from './SettingsGroup'

/** The saved identity remains authoritative until a rename is persisted. */
export function NodeNameField({
  compact = false,
  onModified,
}: {
  compact?: boolean
  onModified?: () => void
}) {
  const { t } = useTranslation()
  const nodeNameSetting = useSettingsStore(state => state.nodeNameSetting)
  const hostnameHint = useSettingsStore(state => state.hostnameHint)
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<'invalid' | 'save' | null>(null)
  const prefix = compact ? 'network' : 'settings'

  const commit = () => {
    if (draft === null || saving) return
    const name = normalizeNodeName(draft)
    if (!name) {
      setError('invalid')
      return
    }
    setError(null)
    if (name === nodeNameSetting) {
      setDraft(null)
      return
    }
    setSaving(true)
    void updatePreferences({ nodeName: name }).then(saved => {
      setSaving(false)
      if (saved) {
        useSettingsStore.getState().setNodeNameSetting(name)
        setDraft(null)
      } else setError('save')
    })
  }

  return (
    <SettingsField
      label={t('settings.nodeName')}
      htmlFor={`${prefix}-node-name`}
    >
      <Input
        id={`${prefix}-node-name`}
        value={draft ?? nodeNameSetting}
        placeholder={t('settings.nodeNamePlaceholder', {
          hostname: hostnameHint || 'hostname',
        })}
        autoComplete="off"
        spellCheck={false}
        disabled={saving}
        aria-invalid={error === 'invalid'}
        aria-describedby={error ? `${prefix}-node-name-error` : undefined}
        onChange={event => {
          setDraft(event.target.value)
          setError(null)
          onModified?.()
        }}
        onBlur={commit}
        className="settings-field-input"
      />
      {error && (
        <p
          id={`${prefix}-node-name-error`}
          className="settings-field-description text-(--pnds-danger)"
          role="alert"
        >
          {t(
            error === 'invalid'
              ? 'participation.nodeSetup.invalidName'
              : 'participation.ui.nameSaveFailed'
          )}
        </p>
      )}
    </SettingsField>
  )
}

export function DeviceIdentityGroup() {
  const { t } = useTranslation()
  return (
    <SettingsGroup
      title={t('settings.presentation.deviceIdentity')}
      description={t('settings.presentation.deviceIdentityHint')}
      footer={t('settings.presentation.deviceIdentitySaveHint')}
    >
      <NodeNameField />
    </SettingsGroup>
  )
}
