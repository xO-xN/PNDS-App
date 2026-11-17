import { useRef, useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { normalizeNodeName, updatePreferences } from '@/lib/preferences'
import { useSettingsStore } from '@/store/settings-store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { PerformanceRoleButton } from './PerformanceRoleButton'
import { TrafficLights } from './TrafficLights'

function NodeNameForm({ id, children }: { id: string; children?: ReactNode }) {
  const { t } = useTranslation()
  const [name, setName] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<'invalid' | 'save' | null>(null)
  const pending = useRef(false)
  return (
    <form
      className="node-name-form"
      onSubmit={event => {
        event.preventDefault()
        if (pending.current) return
        const trimmed = normalizeNodeName(name)
        if (!trimmed) {
          setError('invalid')
          return
        }
        pending.current = true
        setSaving(true)
        setError(null)
        void updatePreferences({ nodeName: trimmed }).then(saved => {
          pending.current = false
          setSaving(false)
          if (saved) {
            useSettingsStore.getState().setNodeNameSetting(trimmed)
          } else setError('save')
        })
      }}
    >
      <label className="participation-field-label" htmlFor={id}>
        {t('settings.nodeName')}
      </label>
      <input
        id={id}
        className="participation-address pnds-focus-ring"
        value={name}
        onChange={event => {
          setName(event.target.value)
          setError(null)
        }}
        placeholder={t('participation.ui.namePlaceholder')}
        autoComplete="off"
        spellCheck={false}
        required
        disabled={saving}
        aria-invalid={error === 'invalid'}
        aria-describedby={error ? `${id}-error` : undefined}
      />
      {children}
      {error && (
        <p id={`${id}-error`} role="alert" className="host-name-error">
          {t(
            error === 'invalid'
              ? 'participation.nodeSetup.invalidName'
              : 'participation.ui.nameSaveFailed'
          )}
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
  )
}

/** First launch names the node before exposing any App mode. */
export function NodeNameSetupDialog() {
  const { t } = useTranslation()
  return (
    <Dialog open>
      <DialogContent
        className="node-name-dialog"
        showCloseButton={false}
        onEscapeKeyDown={event => event.preventDefault()}
        onInteractOutside={event => event.preventDefault()}
      >
        <div>
          <DialogTitle>{t('participation.nodeSetup.title')}</DialogTitle>
          <DialogDescription>
            {t('participation.nodeSetup.help')}
          </DialogDescription>
        </div>
        <NodeNameForm id="app-node-name" />
      </DialogContent>
    </Dialog>
  )
}

/** Unnamed Host fallback before the main App identity is hydrated. */
export function HostNodeSetupSidebar() {
  const { t } = useTranslation()
  return (
    <aside className="host-setup-sidebar">
      <div data-tauri-drag-region className="desktop-sidebar-chrome">
        <TrafficLights />
      </div>
      <div className="performance-sidebar-identity">
        <PerformanceRoleButton />
      </div>
      <div className="participation-sidebar-content">
        <div className="participation-side-heading">
          <h2>{t('participation.ui.nameSetupTitle')}</h2>
          <p>{t('participation.ui.nameSetupHelp')}</p>
        </div>
        <NodeNameForm id="host-node-name">
          <p className="participation-field-help">
            {t('participation.ui.nameRequired')}
          </p>
        </NodeNameForm>
      </div>
      <div className="desktop-sidebar-footer">
        {t('participation.ui.unnamedHost')}
      </div>
    </aside>
  )
}
