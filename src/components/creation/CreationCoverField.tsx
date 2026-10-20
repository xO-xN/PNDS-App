import { useTranslation } from 'react-i18next'
import { Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  coverFieldLabels,
  type CoverDocument,
  type CoverField,
} from '@/lib/creation-readme'

/** A field editor lives over its actual cover element; edits still belong to the
 * existing source-span draft and explicit file save. */
export function CreationCoverField({
  field,
  document,
  onChange,
  open,
  onOpenChange,
}: {
  field: CoverField
  open: boolean
  onOpenChange: (open: boolean) => void
  document: CoverDocument
  onChange: (field: CoverField, value: string) => void
}) {
  const { t } = useTranslation()
  const label = t(`creation.readme.fields.${coverFieldLabels[field]}`)
  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="creation-cover-edit pnds-focus-ring"
          aria-label={t('creation.readme.editElement', { field: label })}
        >
          <span className="creation-cover-edit-hint">
            <Pencil size={13} aria-hidden="true" />
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="center"
        sideOffset={8}
        className="creation-cover-editor text-start"
        onClick={event => event.stopPropagation()}
      >
        <label className="grid gap-2 text-sm font-medium">
          <span>{label}</span>
          {field === 'sectionMarkdown' ? (
            <textarea
              autoFocus
              className="creation-readme-body pnds-focus-ring"
              value={document.fields[field]}
              onChange={event => onChange(field, event.target.value)}
            />
          ) : (
            <Input
              autoFocus
              value={document.fields[field]}
              onChange={event => onChange(field, event.target.value)}
            />
          )}
        </label>
        {field === 'color_palette' && (
          <details className="creation-details">
            <summary className="pnds-focus-ring">
              {t('creation.readme.metadata')}
            </summary>
            <div className="grid gap-3">
              {(['composer_url', 'github_url', 'website_url'] as const).map(
                key => (
                  <label key={key} className="grid gap-1 text-xs">
                    <span>
                      {t(`creation.readme.fields.${coverFieldLabels[key]}`)}
                    </span>
                    <Input
                      value={document.fields[key]}
                      onChange={event => onChange(key, event.target.value)}
                    />
                  </label>
                )
              )}
            </div>
          </details>
        )}
        <div className="mt-3 flex items-center justify-between gap-3">
          <p className="text-xs font-normal text-muted-foreground">
            {t('creation.readme.inlineDraft')}
          </p>
          <Button size="sm" onClick={() => onOpenChange(false)}>
            {t('creation.readme.done')}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}
