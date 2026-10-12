import { useEffect, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { HelpMarkdown } from '@/components/help/HelpMarkdown'
import { ProjectCoverPage } from '@/components/readme/ProjectCoverPage'
import { Input } from '@/components/ui/input'
import {
  coverFields,
  coverFieldLabels,
  inspectEditableReadme,
  type CoverField,
  type EditableReadme,
} from '@/lib/creation-readme'
import { parseReadmeCoverPage } from '@/lib/readme-cover-page'
import {
  readProjectCover,
  resolveProjectReadmeLink,
} from '@/lib/project-readme'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'

export function CreationReadme({
  text,
  root,
  editable,
  document: source,
  onChange,
  className,
}: {
  text: string
  root: string
  editable: boolean
  document?: EditableReadme
  onChange: (field: CoverField, value: string) => void
  className?: string
}) {
  const { t } = useTranslation()
  const document = source ?? inspectEditableReadme(text)
  const page = parseReadmeCoverPage(text)
  const [image, setImage] = useState<{
    root: string
    data: string | null
  } | null>(null)
  const wantsCover = page !== null
  useEffect(() => {
    if (!wantsCover) return
    let live = true
    void readProjectCover(root).then(result => {
      if (live) setImage({ root, data: result.cover })
    })
    return () => {
      live = false
    }
  }, [root, wantsCover])
  const intercept = (event: MouseEvent<HTMLDivElement>) => {
    const anchor = (event.target as HTMLElement).closest('a')
    if (!anchor) return
    event.preventDefault()
    const target = resolveProjectReadmeLink(anchor.getAttribute('href') ?? '')
    if (target)
      void openUrl(target.url).catch((error: unknown) =>
        logger.warn('Failed to open README link', { error })
      )
  }
  return (
    <div className={cn('space-y-5 text-start', className)}>
      {document.kind === 'unsafe' && (
        <p role="status" className="text-sm">
          {t(`creation.readme.unsafe.${document.reason}`)}
        </p>
      )}
      {editable && document.kind === 'cover' && (
        <div className="grid gap-4">
          <p className="text-xs">{t('creation.readme.preserveHint')}</p>
          {coverFields.map(field => (
            <label key={field} className="grid gap-1 text-sm">
              <span>
                {t(`creation.readme.fields.${coverFieldLabels[field]}`)}
              </span>
              {field === 'sectionMarkdown' ? (
                <textarea
                  className="creation-editor-textarea pnds-focus-ring min-h-32"
                  value={document.fields[field]}
                  onChange={event => onChange(field, event.target.value)}
                />
              ) : (
                <Input
                  value={document.fields[field]}
                  onChange={event => onChange(field, event.target.value)}
                />
              )}
            </label>
          ))}
        </div>
      )}
      <div
        onClick={intercept}
        className={cn(
          page
            ? 'relative flex h-[32rem] min-h-0 flex-col overflow-hidden'
            : 'select-text'
        )}
        aria-label={t('creation.readme.preview')}
      >
        {page ? (
          <ProjectCoverPage
            page={page}
            cover={image?.root === root ? image.data : null}
          />
        ) : (
          <HelpMarkdown markdown={text} />
        )}
      </div>
    </div>
  )
}
