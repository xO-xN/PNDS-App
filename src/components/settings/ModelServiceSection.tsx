import { useEffect, useEffectEvent, useReducer, useRef, useState } from 'react'
import { Eye, EyeOff, LoaderCircle } from 'lucide-react'
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
import { TooltipHint } from '@/components/ui/tooltip'
import { SectionTitle } from './SectionTitle'
import { SettingsField } from './SettingsField'
import { SettingsGroup } from './SettingsGroup'
import './model-service-settings.css'

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
  const [keyVisible, setKeyVisible] = useState(false)
  const [confirmation, setConfirmation] = useState<'key' | 'config' | null>(
    null
  )
  const keyInput = useRef<HTMLInputElement>(null)
  const removeKeyButton = useRef<HTMLButtonElement>(null)
  const removeConfigButton = useRef<HTMLButtonElement>(null)
  const cancelRemovalButton = useRef<HTMLButtonElement>(null)
  const confirmationPanel = useRef<HTMLDivElement>(null)
  const focusKeyAfterOperation = useRef(false)
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

  const dismissConfirmation = useEffectEvent(() => cancelRemoval())
  useEffect(() => {
    if (!confirmation) return
    cancelRemovalButton.current?.focus()
    // Radix dismisses the containing dialog at document capture. Consume
    // Escape first, only while focus is inside this inline confirmation.
    const cancel = (event: KeyboardEvent) => {
      if (
        event.key === 'Escape' &&
        event.target instanceof Node &&
        confirmationPanel.current?.contains(event.target)
      ) {
        event.preventDefault()
        event.stopPropagation()
        dismissConfirmation()
      }
    }
    window.addEventListener('keydown', cancel, true)
    return () => window.removeEventListener('keydown', cancel, true)
  }, [confirmation])
  useEffect(() => {
    if (
      pending ||
      (notice !== 'keyRemoved' && notice !== 'configRemoved') ||
      !focusKeyAfterOperation.current
    )
      return
    keyInput.current?.focus()
    focusKeyAfterOperation.current = false
  }, [pending, notice])

  function cancelRemoval() {
    if (confirmation === 'key') removeKeyButton.current?.focus()
    else removeConfigButton.current?.focus()
    setConfirmation(null)
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
      setKey('')
      setKeyVisible(false)
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
      setConfirmation(null)
      focusKeyAfterOperation.current = true
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
      setKeyVisible(false)
      setConfirmation(null)
      focusKeyAfterOperation.current = true
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
          setKeyVisible(false)
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

  const locked =
    (pending !== null && pending !== 'saving') || loading || credentialLoading
  const testFeedback = pending === 'testing' || notice === 'testPassed'
  const serviceError =
    error && error !== 'removeKeyFailed' && error !== 'removeConfigFailed'

  return (
    <section
      id="settings-section-modelService"
      aria-labelledby="settings-modelService-title"
      className="settings-section model-service-settings"
    >
      <SectionTitle id="settings-modelService-title">
        {t('settings.presentation.navigation.modelService')}
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
      >
        <fieldset disabled={locked} className="model-service-fields">
          <SettingsGroup
            title={t('settings.modelService')}
            description={t('settings.modelService.serviceHint')}
            className="model-service-connection"
            status={
              (pending === 'saving' || notice === 'saved') && (
                <p role="status" className="settings-inline-status">
                  {t(
                    pending === 'saving'
                      ? 'settings.modelService.saving'
                      : 'settings.modelService.saved'
                  )}
                </p>
              )
            }
            footer={
              <div className="model-service-test">
                <div className="model-service-test-feedback">
                  {testFeedback && (
                    <p
                      role="status"
                      className="settings-feedback"
                      data-tone={pending === 'testing' ? 'neutral' : 'success'}
                    >
                      {t(
                        pending === 'testing'
                          ? 'settings.modelService.testing'
                          : 'settings.modelService.testPassed'
                      )}
                    </p>
                  )}
                  {!testFeedback &&
                    !serviceError &&
                    !loadError &&
                    !credentialError && (
                      <p className="settings-field-description">
                        {t('settings.modelService.testHint')}
                      </p>
                    )}
                  {serviceError && (
                    <p
                      role="alert"
                      className="settings-feedback"
                      data-tone="danger"
                    >
                      {t(`settings.modelService.${error}`)}
                    </p>
                  )}
                  {loadError && (
                    <p
                      role="alert"
                      className="settings-feedback"
                      data-tone="danger"
                    >
                      {t(`settings.modelService.${loadError}`)}
                    </p>
                  )}
                  {credentialError && error !== 'credentialStore' && (
                    <p
                      role="alert"
                      className="settings-feedback"
                      data-tone="danger"
                    >
                      {t('settings.modelService.credentialStore')}
                    </p>
                  )}
                </div>
                <Button
                  size="sm"
                  type="button"
                  disabled={!baseUrl.trim() || !model.trim()}
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
              </div>
            }
          >
            <SettingsField
              htmlFor="settings-model-base-url"
              label={t('settings.modelService.baseUrl')}
              description={
                <span id="settings-model-url-hint">
                  {t('settings.modelService.urlHint')}
                </span>
              }
            >
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
            </SettingsField>
            <SettingsField
              htmlFor="settings-model-name"
              label={t('settings.modelService.model')}
            >
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
            </SettingsField>
            <SettingsField
              htmlFor="settings-model-key"
              label={t('settings.modelService.key')}
              description={
                <span id="settings-model-key-hint">
                  {t('settings.modelService.keyHint')}
                </span>
              }
            >
              <div className="model-service-secret">
                <Input
                  ref={keyInput}
                  id="settings-model-key"
                  type={keyVisible && key ? 'text' : 'password'}
                  value={key}
                  dir="ltr"
                  spellCheck={false}
                  autoComplete="off"
                  aria-describedby="settings-model-key-hint settings-model-key-state"
                  onChange={event => {
                    setKey(event.target.value)
                    if (!event.target.value) setKeyVisible(false)
                    clearFeedback()
                    markEdited()
                  }}
                />
                <TooltipHint
                  content={t(
                    keyVisible
                      ? 'settings.modelService.hideKey'
                      : 'settings.modelService.showKey'
                  )}
                >
                  <Button
                    type="button"
                    variant="ghost"
                    size="icon-sm"
                    className="model-service-reveal"
                    disabled={!key}
                    aria-label={t(
                      keyVisible
                        ? 'settings.modelService.hideKey'
                        : 'settings.modelService.showKey'
                    )}
                    aria-pressed={keyVisible && !!key}
                    onPointerDown={event => event.preventDefault()}
                    onClick={() => setKeyVisible(value => !value)}
                  >
                    {keyVisible ? (
                      <EyeOff aria-hidden="true" />
                    ) : (
                      <Eye aria-hidden="true" />
                    )}
                  </Button>
                </TooltipHint>
              </div>
              <div className="model-service-key-meta">
                <p
                  id="settings-model-key-state"
                  className="settings-inline-status"
                  aria-live="polite"
                >
                  {t(
                    credentialLoading || pending === 'checkingKey'
                      ? 'settings.modelService.checkingKey'
                      : hasKey === null
                        ? 'settings.modelService.keyUnknown'
                        : hasKey
                          ? 'settings.modelService.keySaved'
                          : 'settings.modelService.noKey'
                  )}
                </p>
                <Button
                  ref={removeKeyButton}
                  size="sm"
                  type="button"
                  variant="ghost"
                  className="model-service-remove-key"
                  disabled={hasKey === false}
                  onClick={() => setConfirmation('key')}
                >
                  {t('settings.modelService.removeKey')}
                </Button>
              </div>
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
              {notice === 'keyRemoved' && (
                <p
                  role="status"
                  className="settings-feedback"
                  data-tone="success"
                >
                  {t('settings.modelService.keyRemoved')}
                </p>
              )}
              {confirmation === 'key' && (
                <div
                  ref={confirmationPanel}
                  className="model-service-confirmation"
                  role="group"
                  aria-labelledby="settings-model-remove-key-title"
                >
                  <h4 id="settings-model-remove-key-title">
                    {t('settings.modelService.confirmRemoveKey')}
                  </h4>
                  <p>{t('settings.modelService.confirmRemoveKeyHint')}</p>
                  {pending === 'removingKey' && (
                    <p role="status">
                      {t('settings.modelService.removingKey')}
                    </p>
                  )}
                  {error === 'removeKeyFailed' && (
                    <p
                      role="alert"
                      className="settings-feedback"
                      data-tone="danger"
                    >
                      {t('settings.modelService.removeKeyFailed')}
                    </p>
                  )}
                  <div className="settings-actions">
                    <Button
                      ref={cancelRemovalButton}
                      type="button"
                      size="sm"
                      variant="outline"
                      onClick={cancelRemoval}
                    >
                      {t('settings.modelService.cancelRemoval')}
                    </Button>
                    <Button
                      type="button"
                      size="sm"
                      variant="outline"
                      className="model-service-danger"
                      onClick={() => runOperation(removeKey)}
                    >
                      {t('settings.modelService.confirmKeyRemoval')}
                    </Button>
                  </div>
                </div>
              )}
            </SettingsField>
          </SettingsGroup>
          <ModelContextFields
            value={draft}
            onChange={value => {
              setDrafts(current => ({ ...current, [profileKey]: value }))
              clearFeedback()
              markEdited()
            }}
          />
          <div className="model-service-removal">
            <div className="model-service-removal-heading">
              <div>
                <h3>{t('settings.modelService.removeConfig')}</h3>
                <p className="settings-field-description">
                  {t('settings.modelService.confirmRemoveConfigHint')}
                </p>
              </div>
              <Button
                ref={removeConfigButton}
                size="sm"
                type="button"
                variant="outline"
                className="model-service-danger"
                disabled={!configured}
                onClick={() => setConfirmation('config')}
              >
                {t('settings.modelService.removeConfig')}
              </Button>
            </div>
            {notice === 'configRemoved' && (
              <p
                role="status"
                className="settings-feedback"
                data-tone="success"
              >
                {t('settings.modelService.configRemoved')}
              </p>
            )}
            {confirmation === 'config' && (
              <div
                ref={confirmationPanel}
                className="model-service-confirmation"
                role="group"
                aria-labelledby="settings-model-remove-config-title"
              >
                <h4 id="settings-model-remove-config-title">
                  {t('settings.modelService.confirmRemoveConfig')}
                </h4>
                <p>{t('settings.modelService.confirmRemoveConfigHint')}</p>
                {pending === 'removingConfig' && (
                  <p role="status">
                    {t('settings.modelService.removingConfig')}
                  </p>
                )}
                {error === 'removeConfigFailed' && (
                  <p
                    role="alert"
                    className="settings-feedback"
                    data-tone="danger"
                  >
                    {t('settings.modelService.removeConfigFailed')}
                  </p>
                )}
                <div className="settings-actions">
                  <Button
                    ref={cancelRemovalButton}
                    type="button"
                    size="sm"
                    variant="outline"
                    onClick={cancelRemoval}
                  >
                    {t('settings.modelService.cancelRemoval')}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="model-service-danger"
                    onClick={() => runOperation(removeConfig)}
                  >
                    {t('settings.modelService.confirmConfigRemoval')}
                  </Button>
                </div>
              </div>
            )}
          </div>
        </fieldset>
      </form>
    </section>
  )
}
