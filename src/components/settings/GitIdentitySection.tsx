import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loadPreferences, updatePreferences } from '@/lib/preferences'
import { Input } from '@/components/ui/input'
import { SettingsGroup } from './SettingsGroup'
import { SettingsField } from './SettingsField'

export function GitIdentitySection() {
  const { t } = useTranslation()
  const [identity, setIdentity] = useState({ name: '', email: '' })
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState(false)
  useEffect(() => {
    let live = true
    void loadPreferences().then(prefs => {
      if (!live) return
      if (prefs)
        setIdentity({ name: prefs.gitName ?? '', email: prefs.gitEmail ?? '' })
      else setError(true)
      setLoading(false)
    })
    return () => {
      live = false
    }
  }, [])
  return (
    <SettingsGroup
      id="settings-git-identity"
      title={t('settings.git')}
      description={t('settings.git.description')}
      footer={
        <>
          <span>{t('settings.git.autoSave')}</span>
          {error && (
            <p role="alert" className="settings-feedback" data-tone="danger">
              {t('settings.git.saveFailed')}
            </p>
          )}
        </>
      }
    >
      {(['name', 'email'] as const).map(field => (
        <SettingsField
          key={field}
          htmlFor={`settings-git-${field}`}
          label={t(`creation.version.${field}`)}
        >
          <Input
            id={`settings-git-${field}`}
            type={field === 'email' ? 'email' : 'text'}
            value={identity[field]}
            disabled={loading}
            maxLength={field === 'email' ? 254 : 128}
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            onChange={event => {
              setIdentity(current => ({
                ...current,
                [field]: event.target.value,
              }))
              setError(false)
            }}
            onBlur={async event => {
              if (!event.target.validity.valid) {
                setError(true)
                return
              }
              const saved = await updatePreferences(
                field === 'name'
                  ? { gitName: identity.name.trim() || null }
                  : { gitEmail: identity.email.trim() || null }
              )
              setError(!saved)
            }}
          />
        </SettingsField>
      ))}
    </SettingsGroup>
  )
}
