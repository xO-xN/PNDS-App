import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Switch } from '@/components/ui/switch'
import { commands, type ControllerMidiPort } from '@/lib/tauri-bindings'
import { updateControllerMapping } from '@/store/controller-mapping-store'
import { SettingsField } from './SettingsField'
import { SettingsGroup } from './SettingsGroup'

interface ControllerMidiSettingsProps {
  ports: ControllerMidiPort[] | null
  readFailed: boolean
  enabledPorts: number[]
}

export function ControllerMidiSettings({
  ports,
  readFailed,
  enabledPorts,
}: ControllerMidiSettingsProps) {
  const { t } = useTranslation()
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)

  return (
    <SettingsGroup title={t('controllerMapping.midiInputs')}>
      {ports?.map(port => {
        const id = `controller-midi-port-${port.id}`
        const checked = enabledPorts.includes(port.id)
        const recent = port.recent
        return (
          <SettingsField
            key={port.id}
            label={port.name}
            htmlFor={id}
            description={
              checked &&
              (port.enabled && !port.connected ? (
                t('controllerMapping.midiUnavailable')
              ) : (
                <span id={`controller-midi-recent-${port.id}`}>
                  {t('controllerMapping.midiActivity', {
                    message:
                      recent?.kind === 'midiNote'
                        ? t('controllerMapping.midiNote', recent)
                        : '—',
                  })}
                </span>
              ))
            }
          >
            <Switch
              id={id}
              checked={checked}
              disabled={busy}
              onCheckedChange={async enabled => {
                setBusy(true)
                setFailed(
                  !(await updateControllerMapping(
                    commands.configureControllerMidiPort(port.id, enabled)
                  ))
                )
                setBusy(false)
              }}
            />
          </SettingsField>
        )
      })}
      {ports?.length === 0 && (
        <p className="settings-helper-text">
          {t('controllerMapping.midiNoInputs')}
        </p>
      )}
      {(failed || readFailed) && (
        <p role="alert" className="settings-helper-text">
          {t('controllerMapping.midiFailed')}
        </p>
      )}
    </SettingsGroup>
  )
}
