import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loadPreferences, updatePreferences } from '@/lib/preferences'
import { Input } from '@/components/ui/input'
import { SectionTitle } from './SectionTitle'

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
    <section
      id="settings-section-git"
      className="settings-section"
      aria-labelledby="settings-git-title"
    >
      <SectionTitle id="settings-git-title">{t('settings.git')}</SectionTitle>
      <p className="settings-field-description">
        {t('settings.git.description')}
      </p>
      <div className="settings-fields">
        {(['name', 'email'] as const).map(field => (
          <div key={field} className="settings-field">
            <label
              htmlFor={`settings-git-${field}`}
              className="settings-field-label"
            >
              {t(`creation.version.${field}`)}
            </label>
            <div className="settings-field-control">
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
            </div>
          </div>
        ))}
      </div>
      {error && (
        <p role="alert" className="settings-feedback" data-tone="danger">
          {t('settings.git.saveFailed')}
        </p>
      )}
    </section>
  )
}
