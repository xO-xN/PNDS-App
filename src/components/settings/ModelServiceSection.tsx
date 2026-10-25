import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react'
import { LoaderCircle } from 'lucide-react'
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
  const [editRevision, markEdited] = useReducer(value => value + 1, 0)
  const autosave = useRef<(() => void) | null>(null)
  const autosaveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(
    undefined
  )
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

  function cancelAutosave() {
    clearTimeout(autosaveTimer.current)
    autosave.current = null
  }

  function runOperation(action: () => Promise<void>) {
    cancelAutosave()
    const operation = Promise.resolve(pendingOperation)
      .then(action)
      .catch(() => setError('commandFailed'))
      .finally(() => {
        if (pendingOperation === operation) pendingOperation = null
      })
    pendingOperation = operation
  }

  function flushAutosave() {
    const action = autosave.current
    if (action) action()
  }

  const prepareAutosave = useEffectEvent(() => () => runOperation(save))
  useEffect(() => {
    if (!editRevision || loading || credentialLoading) return
    const action = prepareAutosave()
    autosave.current = action
    autosaveTimer.current = setTimeout(action, 600)
    return () => clearTimeout(autosaveTimer.current)
  }, [editRevision, loading, credentialLoading])
  useEffect(
    () => () => {
      clearTimeout(autosaveTimer.current)
      const action = autosave.current
      if (action) action()
    },
    []
  )

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
    if (!baseUrl.trim() || !model.trim()) return
    const enteredKey = key
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
          setKey(current => (current === enteredKey ? '' : current))
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
      className="settings-section"
    >
      <SectionTitle id="settings-modelService-title">
        {t('settings.modelService')}
      </SectionTitle>
      {loading && (
        <p role="status" className="settings-inline-status">
          {t('settings.modelService.loading')}
        </p>
      )}
      <form
        aria-busy={pending !== null || loading || credentialLoading}
        onSubmit={event => {
          event.preventDefault()
          runOperation(save)
        }}
        onBlur={event => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            flushAutosave()
        }}
        className="settings-section"
      >
        <fieldset
          disabled={
            (pending !== null && pending !== 'saving') ||
            loading ||
            credentialLoading
          }
          className="settings-section"
        >
          <div className="settings-fields">
            <div className="settings-field">
              <div className="settings-field-label">
                <Label htmlFor="settings-model-base-url">
                  {t('settings.modelService.baseUrl')}
                </Label>
                <p
                  id="settings-model-url-hint"
                  className="settings-field-description"
                >
                  {t('settings.modelService.urlHint')}
                </p>
              </div>
              <div className="settings-field-control">
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
                    markEdited()
                  }}
                />
              </div>
            </div>
            <div className="settings-field">
              <Label
                htmlFor="settings-model-name"
                className="settings-field-label"
              >
                {t('settings.modelService.model')}
              </Label>
              <div className="settings-field-control">
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
                    markEdited()
                  }}
                />
              </div>
            </div>
            <div className="settings-field">
              <div className="settings-field-label">
                <Label htmlFor="settings-model-key">
                  {t('settings.modelService.key')}
                </Label>
                <p
                  id="settings-model-key-hint"
                  className="settings-field-description"
                >
                  {t('settings.modelService.keyHint')}
                </p>
              </div>
              <div className="settings-field-control">
                <Input
                  id="settings-model-key"
                  type="password"
                  value={key}
                  dir="ltr"
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby="settings-model-key-hint settings-model-key-state"
                  onChange={event => {
                    setKey(event.target.value)
                    clearFeedback()
                    markEdited()
                  }}
                />
                <p
                  id="settings-model-key-state"
                  className="settings-inline-status"
                  aria-live="polite"
                >
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
                    onClick={() => {
                      flushAutosave()
                      runOperation(retryCredential)
                    }}
                  >
                    {t('settings.modelService.retryCredential')}
                  </Button>
                )}
              </div>
            </div>
          </div>
          <div className="settings-actions">
            <Button
              size="sm"
              type="button"
              disabled={
                !baseUrl.trim() || !model.trim() || (!hasKey && !key.trim())
              }
              onClick={() => {
                flushAutosave()
                runOperation(testConnection)
              }}
            >
              {pending === 'testing' && (
                <LoaderCircle
                  aria-hidden="true"
                  className="size-4 animate-spin motion-reduce:animate-none"
                />
              )}
              {t('settings.modelService.test')}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              disabled={!configured}
              onClick={() => runOperation(removeConfig)}
            >
              {t('settings.modelService.removeConfig')}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              disabled={hasKey === false}
              onClick={() => {
                flushAutosave()
                runOperation(removeKey)
              }}
            >
              {t('settings.modelService.removeKey')}
            </Button>
          </div>
          <p className="settings-field-description">
            {t('settings.modelService.testHint')}
          </p>
          <ModelContextFields
            value={draft}
            onChange={value => {
              setDrafts(current => ({ ...current, [profileKey]: value }))
              clearFeedback()
              markEdited()
            }}
          />
        </fieldset>
        {pending && (
          <p
            role="status"
            className={pending === 'testing' ? 'sr-only' : 'settings-feedback'}
            data-tone="neutral"
          >
            {t(`settings.modelService.${pending}`)}
          </p>
        )}
        {notice && (
          <p role="status" className="settings-feedback" data-tone="success">
            {t(`settings.modelService.${notice}`)}
          </p>
        )}
        {error && (
          <p role="alert" className="settings-feedback" data-tone="danger">
            {t(`settings.modelService.${error}`)}
          </p>
        )}
        {loadError && (
          <p role="alert" className="settings-feedback" data-tone="danger">
            {t(`settings.modelService.${loadError}`)}
          </p>
        )}
        {credentialError && error !== 'credentialStore' && (
          <p role="alert" className="settings-feedback" data-tone="danger">
            {t('settings.modelService.credentialStore')}
          </p>
        )}
      </form>
    </section>
  )
}
