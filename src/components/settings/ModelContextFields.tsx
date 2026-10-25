import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Switch } from '@/components/ui/switch'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import type { ContextDraft } from '@/lib/model-context-settings'

export function ModelContextFields({
  value,
  onChange,
}: {
  value: ContextDraft
  onChange: (draft: ContextDraft) => void
}) {
  const { t } = useTranslation()
  const capacity = Number(value.capacity)
  const reserve =
    Number(value.maxOutput) +
    Number(value.reasoningReserve) +
    Number(value.safetyMargin)
  const target = Number(value.inputTarget)
  const available = value.capacity
    ? value.maxOutput &&
      capacity > reserve &&
      (!value.inputTarget || target > 0)
      ? Math.min(capacity - reserve, target || Infinity)
      : null
    : value.inputTarget && target > 0
      ? target
      : null
  return (
    <details className="settings-details">
      <summary id="settings-model-context-title">
        {t('settings.modelContext.title')}
      </summary>
      <fieldset
        className="settings-section"
        aria-labelledby="settings-model-context-title"
        aria-describedby="settings-model-context-hint"
      >
        <p
          id="settings-model-context-hint"
          className="settings-field-description"
        >
          {t('settings.modelContext.hint')}
        </p>
        <div className="settings-fields">
          <div className="settings-field">
            <div className="settings-field-label">
              <Label htmlFor="settings-model-context-capacity">
                {t('settings.modelContext.capacity')}
              </Label>
              <p
                id="settings-model-context-capacity-hint"
                className="settings-field-description"
              >
                {t('settings.modelContext.capacityHint')}
              </p>
            </div>
            <div className="settings-field-control">
              <Input
                id="settings-model-context-capacity"
                type="number"
                min={1}
                max={16000000}
                step={1}
                dir="ltr"
                value={value.capacity}
                aria-describedby="settings-model-context-capacity-hint"
                onChange={event =>
                  onChange({ ...value, capacity: event.target.value })
                }
              />
            </div>
          </div>
          <div className="settings-field">
            <Label
              htmlFor="settings-model-context-manual"
              className="settings-field-label"
            >
              {t('settings.modelContext.manual')}
            </Label>
            <div className="settings-field-control">
              <Switch
                id="settings-model-context-manual"
                checked={value.mode === 'manual'}
                onCheckedChange={checked =>
                  onChange({
                    ...value,
                    mode: checked ? 'manual' : 'auto',
                  })
                }
              />
            </div>
          </div>
          {(
            [
              'inputTarget',
              'maxOutput',
              'reasoningReserve',
              'safetyMargin',
            ] as const
          )
            .filter(
              field =>
                value.mode === 'manual' ||
                field === 'maxOutput' ||
                field === 'reasoningReserve'
            )
            .map(field => (
              <div key={field} className="settings-field">
                <Label
                  htmlFor={`settings-model-context-${field}`}
                  className="settings-field-label"
                >
                  {t(`settings.modelContext.${field}`)}
                </Label>
                <div className="settings-field-control">
                  <Input
                    id={`settings-model-context-${field}`}
                    type="number"
                    min={
                      field === 'reasoningReserve' || field === 'safetyMargin'
                        ? 0
                        : 1
                    }
                    max={16000000}
                    step={1}
                    dir="ltr"
                    value={value[field]}
                    placeholder={
                      field === 'maxOutput'
                        ? t('settings.modelContext.providerDefault')
                        : undefined
                    }
                    onChange={event =>
                      onChange({ ...value, [field]: event.target.value })
                    }
                  />
                </div>
              </div>
            ))}
          <div className="settings-field">
            <Label
              htmlFor="settings-model-context-tokenizer"
              className="settings-field-label"
            >
              {t('settings.modelContext.tokenizer')}
            </Label>
            <div className="settings-field-control">
              <Select
                value={value.tokenizer}
                onValueChange={tokenizer =>
                  onChange({
                    ...value,
                    tokenizer: tokenizer as ContextDraft['tokenizer'],
                  })
                }
              >
                <SelectTrigger
                  id="settings-model-context-tokenizer"
                  className="w-full"
                >
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="unknown">
                    {t('settings.modelContext.unknown')}
                  </SelectItem>
                  <SelectItem value="cl100kBase">
                    cl100k_base (tiktoken-rs 0.7)
                  </SelectItem>
                  <SelectItem value="o200kBase">
                    o200k_base (tiktoken-rs 0.7)
                  </SelectItem>
                </SelectContent>
              </Select>
            </div>
          </div>
        </div>
        <p className="settings-field-description">
          {t('settings.modelContext.outputHint')}
        </p>
        <p className="settings-inline-status">
          {value.mode !== 'manual'
            ? t('settings.modelContext.automatic')
            : available === null
              ? t('settings.modelContext.inputUnknown')
              : t('settings.modelContext.available', { count: available })}
        </p>
        <p className="settings-field-description">
          {t('settings.modelContext.safety')}
        </p>
      </fieldset>
    </details>
  )
}
