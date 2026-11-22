import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { commands } from '@/lib/tauri-bindings'
import {
  updateControllerMapping,
  useControllerMappingStore,
} from '@/store/controller-mapping-store'
import { useSettingsStore } from '@/store/settings-store'
import { SettingsField } from './SettingsField'
import { SettingsGroup } from './SettingsGroup'

export function ControllerOscInputSettings() {
  const { t } = useTranslation()
  const osc = useControllerMappingStore(
    state => state.snapshot?.preferences.osc
  )
  const oscError = useControllerMappingStore(state => state.snapshot?.oscError)
  const visible = useSettingsStore(
    state => state.settingsOpen && state.focusSection === 'controllerMapping'
  )
  const [portDraft, setPortDraft] = useState<string | null>(null)
  const [enabledDraft, setEnabledDraft] = useState<boolean | null>(null)
  const [lanDraft, setLanDraft] = useState<boolean | null>(null)
  const [senderDraft, setSenderDraft] = useState<string | null>(null)
  const [recent, setRecent] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const port = portDraft ?? String(osc?.port ?? 9000)
  const enabled = enabledDraft ?? osc?.enabled ?? false
  const lanEnabled = lanDraft ?? osc?.lanEnabled ?? false
  const savedSenders = osc?.lanSenders?.join('\n') ?? ''
  const senders = senderDraft ?? savedSenders

  useEffect(() => {
    if (!visible || !osc?.enabled) return
    let live = true
    const read = () => {
      void commands
        .getControllerOscActivity()
        .then(result => {
          if (live && result.status === 'ok') setRecent(result.data)
        })
        .catch(() => undefined)
    }
    read()
    const watcher = setInterval(read, 400)
    return () => {
      live = false
      clearInterval(watcher)
    }
  }, [visible, osc?.enabled, osc?.port, osc?.lanEnabled, savedSenders])

  return (
    <form
      id="controller-osc-settings"
      onSubmit={async event => {
        event.preventDefault()
        setBusy(true)
        const lanSenders = (lanEnabled ? senders : savedSenders)
          .split(/[\s,]+/)
          .filter(Boolean)
        const saved = await updateControllerMapping(
          commands.configureControllerOsc({
            enabled,
            port: Number(port),
            lanEnabled,
            lanSenders,
          })
        )
        if (saved) {
          setEnabledDraft(null)
          setPortDraft(null)
          setLanDraft(null)
          setSenderDraft(null)
          setRecent(null)
        }
        setFailed(!saved)
        setBusy(false)
      }}
    >
      <SettingsGroup
        title={t('controllerMapping.oscInput')}
        description={t('controllerMapping.localAddress')}
        footer={
          <Button type="submit" disabled={busy || !osc}>
            {t('controllerMapping.apply')}
          </Button>
        }
      >
        <SettingsField
          label={t('controllerMapping.oscEnabled')}
          htmlFor="controller-osc-enabled"
        >
          <Switch
            id="controller-osc-enabled"
            checked={enabled}
            onCheckedChange={setEnabledDraft}
            disabled={busy}
          />
        </SettingsField>
        <SettingsField
          label={t('controllerMapping.receivePort')}
          htmlFor="controller-osc-port"
        >
          <Input
            id="controller-osc-port"
            type="number"
            inputMode="numeric"
            min={1}
            max={65535}
            required
            value={port}
            disabled={busy}
            onChange={event => setPortDraft(event.currentTarget.value)}
          />
        </SettingsField>
        <SettingsField
          label={t('controllerMapping.lanEnabled')}
          htmlFor="controller-osc-lan"
        >
          <Switch
            id="controller-osc-lan"
            checked={lanEnabled}
            onCheckedChange={setLanDraft}
            disabled={busy}
          />
        </SettingsField>
        {lanEnabled && (
          <SettingsField
            label={t('controllerMapping.lanSenders')}
            description={t('controllerMapping.lanSendersHint')}
            htmlFor="controller-osc-senders"
          >
            <Textarea
              id="controller-osc-senders"
              dir="ltr"
              spellCheck={false}
              value={senders}
              disabled={busy}
              onChange={event => setSenderDraft(event.currentTarget.value)}
            />
          </SettingsField>
        )}
        <SettingsField label={t('controllerMapping.recentInput')}>
          <output id="controller-osc-latest" dir="ltr">
            {(osc?.enabled && recent) || '—'}
          </output>
        </SettingsField>
        {(failed || oscError) && (
          <p role="alert" className="settings-helper-text">
            {t('controllerMapping.oscFailed')}
          </p>
        )}
      </SettingsGroup>
    </form>
  )
}
