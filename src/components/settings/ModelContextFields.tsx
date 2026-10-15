import { useTranslation } from 'react-i18next'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
    ? capacity > reserve && (!value.inputTarget || target > 0)
      ? Math.min(capacity - reserve, target || Infinity)
      : null
    : value.inputTarget && target > 0
      ? target
      : null
  return (
    <fieldset
      className="flex min-w-0 flex-col gap-3 rounded-md border border-(--pnds-border) p-3"
      aria-describedby="settings-model-context-hint"
    >
      <legend className="px-1 text-sm">
        {t('settings.modelContext.title')}
      </legend>
      <p
        id="settings-model-context-hint"
        className="text-muted-foreground text-xs"
      >
        {t('settings.modelContext.hint')}
      </p>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {(
          [
            'capacity',
            'inputTarget',
            'maxOutput',
            'reasoningReserve',
            'safetyMargin',
          ] as const
        ).map(field => (
          <div key={field} className="flex flex-col gap-1.5">
            <Label htmlFor={`settings-model-context-${field}`}>
              {t(`settings.modelContext.${field}`)}
            </Label>
            <Input
              id={`settings-model-context-${field}`}
              type="number"
              min={
                field === 'reasoningReserve' || field === 'safetyMargin' ? 0 : 1
              }
              max={16000000}
              step={1}
              dir="ltr"
              value={value[field]}
              onChange={event =>
                onChange({ ...value, [field]: event.target.value })
              }
            />
          </div>
        ))}
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="settings-model-context-tokenizer">
            {t('settings.modelContext.tokenizer')}
          </Label>
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
      <p className="text-xs">
        {available === null
          ? t('settings.modelContext.inputUnknown')
          : t('settings.modelContext.available', { count: available })}
      </p>
      <p className="text-muted-foreground text-xs">
        {t('settings.modelContext.safety')}
      </p>
    </fieldset>
  )
}
