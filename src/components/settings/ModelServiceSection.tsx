import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { loadPreferences, updateModelService } from '@/lib/preferences'
import {
  contextDraft,
  modelProfileKey,
  parseContextDraft,
  type ContextDraft,
} from '@/lib/model-context-settings'
import type { ModelServiceConfig } from '@/lib/tauri-bindings'
import { ModelContextFields } from './ModelContextFields'
import { commands, type ModelServiceError } from '@/lib/tauri-bindings'
import { Input } from '@/components/ui/input'
import { Button } from '@/components/ui/button'
import { Label } from '@/components/ui/label'
import { SectionTitle } from './SectionTitle'

// A settings dialog can close while a native command is pending. Keep the
// whole config-to-credential operation owned across unmounts; a new dialog
// waits for completion before restoring values or accepting another action.
let pendingOperation: Promise<void> | null = null

export function ModelServiceSection() {
  const { t } = useTranslation()
  const [baseUrl, setBaseUrl] = useState('')
  const [model, setModel] = useState('')
  const [key, setKey] = useState('')
  const [profiles, setProfiles] = useState<ModelServiceConfig[]>([])
  const [drafts, setDrafts] = useState<Record<string, ContextDraft>>({})
  const profileKey = modelProfileKey({ baseUrl, model })
  const draft =
    drafts[profileKey] ??
    contextDraft(
      profiles.find(profile => modelProfileKey(profile) === profileKey)?.context
    )
  function currentConfig(): ModelServiceConfig {
    const context = parseContextDraft(draft)
    return {
      baseUrl: baseUrl.trim().replace(/\/+$/, ''),
      model: model.trim(),
      ...(context ? { context } : {}),
    }
  }
  const [hasKey, setHasKey] = useState<boolean | null>(null)
  const [configured, setConfigured] = useState<boolean | null>(null)
  const [loading, setLoading] = useState(true)
  const [credentialLoading, setCredentialLoading] = useState(true)
  const [loadError, setLoadError] = useState<'loadFailed' | null>(null)
  const [credentialError, setCredentialError] = useState(false)
  const [pending, setPending] = useState<
    | 'saving'
    | 'testing'
    | 'removingKey'
    | 'removingConfig'
    | 'checkingKey'
    | null
  >(null)
  const [notice, setNotice] = useState<
    'saved' | 'testPassed' | 'keyRemoved' | 'configRemoved' | null
  >(null)
  const [error, setError] = useState<
    | ModelServiceError['type']
    | 'saveFailed'
    | 'configSavedKeyFailed'
    | 'commandFailed'
    | 'removeKeyFailed'
    | 'removeConfigFailed'
    | 'invalidContext'
    | null
  >(null)

  function clearFeedback() {
    setNotice(null)
    setError(null)
  }

  function runOperation(action: () => Promise<void>) {
    if (pendingOperation) return
    const operation = action()
      .catch(() => setError('commandFailed'))
      .finally(() => {
        if (pendingOperation === operation) pendingOperation = null
      })
    pendingOperation = operation
  }

  async function retryCredential() {
    setPending('checkingKey')
    clearFeedback()
    try {
      const result = await commands.getModelCredentialStatus()
      if (result.status === 'error') {
        setCredentialError(true)
        return
      }
      setHasKey(result.data.hasKey)
      setCredentialError(false)
    } catch {
      setCredentialError(true)
    } finally {
      setPending(null)
    }
  }

  async function removeConfig() {
    setPending('removingConfig')
    clearFeedback()
    try {
      if (!(await updateModelService(null))) {
        setError('removeConfigFailed')
        return
      }
      setBaseUrl('')
      setModel('')
      setProfiles(current =>
        current.filter(profile => modelProfileKey(profile) !== profileKey)
      )
      setDrafts(current => {
        return Object.fromEntries(
          Object.entries(current).filter(([id]) => id !== profileKey)
        )
      })
      setConfigured(false)
      setLoadError(null)
      setNotice('configRemoved')
    } finally {
      setPending(null)
    }
  }

  async function removeKey() {
    setPending('removingKey')
    clearFeedback()
    try {
      const result = await commands.removeModelCredential()
      if (result.status === 'error') {
        setError('removeKeyFailed')
        return
      }
      setHasKey(false)
      setCredentialError(false)
      setKey('')
      setNotice('keyRemoved')
    } catch {
      setError('removeKeyFailed')
    } finally {
      setPending(null)
    }
  }

  async function testConnection() {
    setPending('testing')
    clearFeedback()
    try {
      const result = await commands.testModelConnection(
        currentConfig(),
        key.trim() || null
      )
      if (result.status === 'error') setError(result.error.type)
      else if (result.data.text && result.data.toolCall) setNotice('testPassed')
      else setError('protocol')
    } catch (error) {
      setError(
        error instanceof Error && error.message === 'invalidContext'
          ? 'invalidContext'
          : 'commandFailed'
      )
    } finally {
      setPending(null)
    }
  }

  async function save() {
    setPending('saving')
    clearFeedback()
    try {
      let config: ModelServiceConfig
      try {
        config = currentConfig()
      } catch {
        setError('invalidContext')
        return
      }
      const saved = await updateModelService(config)
      if (!saved) {
        setError('saveFailed')
        return
      }
      setConfigured(true)
      setProfiles(current => [
        ...current.filter(
          profile => modelProfileKey(profile) !== modelProfileKey(config)
        ),
        config,
      ])
      setLoadError(null)
      if (key.trim()) {
        try {
          const result = await commands.saveModelCredential(key.trim())
          if (result.status === 'error') {
            setError('configSavedKeyFailed')
            return
          }
          setKey('')
          setHasKey(true)
          setCredentialError(false)
        } catch {
          setError('configSavedKeyFailed')
          return
        }
      }
      setNotice('saved')
    } finally {
      setPending(null)
    }
  }

  useEffect(() => {
    let stale = false
    void (async () => {
      await pendingOperation
      if (stale) return
      await Promise.allSettled([
        loadPreferences().then(prefs => {
          if (stale) return
          if (prefs) {
            setBaseUrl(prefs.modelService?.baseUrl ?? '')
            setModel(prefs.modelService?.model ?? '')
            setProfiles([
              ...(prefs.modelService ? [prefs.modelService] : []),
              ...(prefs.modelContextProfiles ?? []),
            ])
            setConfigured(Boolean(prefs.modelService))
          } else setLoadError('loadFailed')
          setLoading(false)
        }),
        commands
          .getModelCredentialStatus()
          .then(credential => {
            if (stale) return
            if (credential.status === 'ok') setHasKey(credential.data.hasKey)
            else setCredentialError(true)
          })
          .catch(() => {
            if (!stale) setCredentialError(true)
          })
          .finally(() => {
            if (!stale) setCredentialLoading(false)
          }),
      ])
    })()
    return () => {
      stale = true
    }
  }, [])

  return (
    <section
      id="settings-section-modelService"
      aria-labelledby="settings-modelService-title"
      className="flex flex-col gap-3 py-4"
    >
      <SectionTitle id="settings-modelService-title">
        {t('settings.modelService')}
      </SectionTitle>
      <p className="text-muted-foreground text-sm">
        {t('settings.modelService.description')}
      </p>
      <p className="text-sm">
        {t(
          loading
            ? 'settings.modelService.loading'
            : configured === null
              ? 'settings.modelService.configUnknown'
              : configured
                ? 'settings.modelService.configured'
                : 'settings.modelService.unconfigured'
        )}
      </p>
      <form
        aria-busy={pending !== null || loading || credentialLoading}
        onSubmit={event => {
          event.preventDefault()
          runOperation(save)
        }}
        className="flex flex-col gap-3"
      >
        <fieldset
          disabled={pending !== null || loading || credentialLoading}
          className="flex min-w-0 flex-col gap-4"
        >
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-model-base-url">
              {t('settings.modelService.baseUrl')}
            </Label>
            <Input
              id="settings-model-base-url"
              type="url"
              required
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              placeholder="https://api.example.com/v1"
              aria-describedby="settings-model-url-hint"
              value={baseUrl}
              onChange={event => {
                setBaseUrl(event.target.value)
                clearFeedback()
              }}
            />
            <p
              id="settings-model-url-hint"
              className="text-muted-foreground text-xs"
            >
              {t('settings.modelService.urlHint')}
            </p>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-model-name">
              {t('settings.modelService.model')}
            </Label>
            <Input
              id="settings-model-name"
              required
              dir="ltr"
              autoComplete="off"
              spellCheck={false}
              value={model}
              onChange={event => {
                setModel(event.target.value)
                clearFeedback()
              }}
            />
          </div>
          <ModelContextFields
            value={draft}
            onChange={value => {
              setDrafts(current => ({ ...current, [profileKey]: value }))
              clearFeedback()
            }}
          />
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="settings-model-key">
              {t('settings.modelService.key')}
            </Label>
            <Input
              id="settings-model-key"
              type="password"
              placeholder={
                hasKey
                  ? t('settings.modelService.savedKeyPlaceholder')
                  : undefined
              }
              value={key}
              dir="ltr"
              spellCheck={false}
              autoComplete="off"
              aria-describedby="settings-model-key-hint"
              onChange={event => {
                setKey(event.target.value)
                clearFeedback()
              }}
            />
            <p
              id="settings-model-key-hint"
              className="text-muted-foreground text-xs"
            >
              {t('settings.modelService.keyHint')}
            </p>
            <p className="text-xs" aria-live="polite">
              {t(
                credentialLoading
                  ? 'settings.modelService.checkingKey'
                  : hasKey === null
                    ? 'settings.modelService.keyUnknown'
                    : hasKey
                      ? 'settings.modelService.keySaved'
                      : 'settings.modelService.noKey'
              )}
            </p>
            {(credentialError || error === 'credentialStore') && (
              <Button
                size="sm"
                type="button"
                variant="outline"
                className="self-start"
                onClick={() => runOperation(retryCredential)}
              >
                {t('settings.modelService.retryCredential')}
              </Button>
            )}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              type="submit"
              disabled={!baseUrl.trim() || !model.trim()}
            >
              {t('settings.modelService.save')}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={
                !baseUrl.trim() || !model.trim() || (!hasKey && !key.trim())
              }
              onClick={() => runOperation(testConnection)}
            >
              {t('settings.modelService.test')}
            </Button>
          </div>
          <p className="text-muted-foreground text-xs">
            {t('settings.modelService.testHint')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={!configured}
              onClick={() => runOperation(removeConfig)}
            >
              {t('settings.modelService.removeConfig')}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={hasKey === false}
              onClick={() => runOperation(removeKey)}
            >
              {t('settings.modelService.removeKey')}
            </Button>
          </div>
        </fieldset>
        {pending && (
          <p role="status" className="text-muted-foreground text-sm">
            {t(`settings.modelService.${pending}`)}
          </p>
        )}
        {notice && (
          <p role="status" className="text-sm">
            {t(`settings.modelService.${notice}`)}
          </p>
        )}
        {error && (
          <p role="alert" className="text-destructive text-sm">
            {t(`settings.modelService.${error}`)}
          </p>
        )}
        {loadError && (
          <p role="alert" className="text-destructive text-sm">
            {t(`settings.modelService.${loadError}`)}
          </p>
        )}
        {credentialError && (
          <p role="alert" className="text-destructive text-sm">
            {t('settings.modelService.credentialStore')}
          </p>
        )}
      </form>
    </section>
  )
}
