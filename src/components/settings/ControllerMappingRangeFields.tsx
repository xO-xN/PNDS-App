import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  commands,
  type ControllerMapping,
  type ControllerMappingRange,
} from '@/lib/tauri-bindings'
import { updateControllerMapping } from '@/store/controller-mapping-store'

interface Props {
  scope: string
  mapping: ControllerMapping
  range: ControllerMappingRange
}

const bounds = ['inputMin', 'inputMax', 'targetMin', 'targetMax'] as const

export function ControllerMappingRangeFields({ scope, mapping, range }: Props) {
  const { t } = useTranslation()
  const id = useId()
  const [reversedDraft, setReversedDraft] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [failed, setFailed] = useState(false)
  const reversed = reversedDraft ?? range.reversed
  const name = mapping.target.name || t('controllerMapping.unnamedControl')

  return (
    <form
      aria-label={t('controllerMapping.rangeFor', { name })}
      className="controller-mapping-range"
      onSubmit={async event => {
        event.preventDefault()
        const fields = new FormData(event.currentTarget)
        setBusy(true)
        const saved = await updateControllerMapping(
          commands.configureControllerMappingRange(scope, mapping.target.id, {
            inputMin: Number(fields.get('inputMin')),
            inputMax: Number(fields.get('inputMax')),
            targetMin: Number(fields.get('targetMin')),
            targetMax: Number(fields.get('targetMax')),
            reversed,
          })
        )
        if (saved) setReversedDraft(null)
        setFailed(!saved)
        setBusy(false)
      }}
    >
      {bounds.map(field => (
        <div key={field}>
          <Label htmlFor={id + field}>{t(`controllerMapping.${field}`)}</Label>
          <Input
            key={range[field]}
            id={id + field}
            type="number"
            step="any"
            name={field}
            required
            readOnly={
              mapping.address.kind !== 'osc' && field.startsWith('input')
            }
            disabled={busy}
            defaultValue={range[field]}
          />
        </div>
      ))}
      <div className="controller-mapping-reverse">
        <Switch
          id={id + 'reverse'}
          checked={reversed}
          onCheckedChange={setReversedDraft}
          disabled={busy}
        />
        <Label htmlFor={id + 'reverse'}>{t('controllerMapping.reverse')}</Label>
      </div>
      <Button type="submit" variant="outline" disabled={busy}>
        {t('controllerMapping.applyRange')}
      </Button>
      {failed && (
        <p role="alert" className="settings-helper-text">
          {t('controllerMapping.invalidRange')}
        </p>
      )}
    </form>
  )
}
