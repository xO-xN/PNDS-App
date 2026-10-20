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
      className="flex flex-col gap-4 py-4"
      aria-labelledby="settings-git-title"
    >
      <SectionTitle id="settings-git-title">{t('settings.git')}</SectionTitle>
      <p className="text-sm text-muted-foreground">
        {t('settings.git.description')}
      </p>
      {(['name', 'email'] as const).map(field => (
        <label key={field} className="grid gap-1.5 text-sm">
          <span>{t(`creation.version.${field}`)}</span>
          <Input
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
        </label>
      ))}
      <p className="text-xs text-muted-foreground">
        {t('settings.git.autoSave')}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {t('settings.git.saveFailed')}
        </p>
      )}
    </section>
  )
}
