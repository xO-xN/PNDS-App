import { useEffect, useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { HelpMarkdown } from '@/components/help/HelpMarkdown'
import { ProjectCoverPage } from '@/components/readme/ProjectCoverPage'
import {
  inspectEditableReadme,
  type CoverField,
  type EditableReadme,
} from '@/lib/creation-readme'
import {
  parseReadmeCoverPage,
  DEFAULT_COVER_PALETTE,
} from '@/lib/readme-cover-page'
import {
  readProjectCover,
  resolveProjectReadmeLink,
} from '@/lib/project-readme'
import { logger } from '@/lib/logger'
import { cn } from '@/lib/utils'
import { CreationCoverField } from './CreationCoverField'

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
  const [editing, setEditing] = useState<CoverField | null>(null)
  const parsed =
    parseReadmeCoverPage(text) ??
    (document.kind === 'cover'
      ? parseReadmeCoverPage(
          `title: _\ncolor_palette: ${document.fields.color_palette}\n\n## _\n`
        )
      : null)
  // Draft fields can temporarily be empty or contain an unfinished Markdown
  // fence. Keep the same cover and field editor mounted throughout typing.
  const page =
    document.kind === 'cover'
      ? {
          ...(parsed ?? {
            composerUrl: null,
            githubUrl: null,
            websiteUrl: null,
            palette: DEFAULT_COVER_PALETTE,
          }),
          title: document.fields.title,
          composer: document.fields.composer || null,
          duration: document.fields.duration || null,
          performers: document.fields.performers || null,
          contact: document.fields.contact || null,
          sectionLabel: document.fields.sectionLabel,
          sectionMarkdown: document.fields.sectionMarkdown,
        }
      : parsed
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
    <div
      className={cn(
        'creation-readme text-start',
        page && 'creation-readme-cover',
        className
      )}
    >
      {document.kind === 'unsafe' && (
        <p role="status" className="text-sm">
          {t(`creation.readme.unsafe.${document.reason}`)}
        </p>
      )}
      <div
        onClick={intercept}
        className={
          page
            ? 'creation-readme-preview'
            : 'creation-readme-document select-text'
        }
        aria-label={t('creation.readme.preview')}
      >
        {page ? (
          <div className="creation-cover-frame">
            <ProjectCoverPage
              page={page}
              cover={image?.root === root ? image.data : null}
              editorActive={editing !== null}
              renderEditor={
                editable && document.kind === 'cover'
                  ? field => (
                      <CreationCoverField
                        key={field}
                        field={field}
                        document={document}
                        onChange={onChange}
                        open={editing === field}
                        onOpenChange={open =>
                          setEditing(current =>
                            open ? field : current === field ? null : current
                          )
                        }
                      />
                    )
                  : undefined
              }
            />
          </div>
        ) : (
          <HelpMarkdown markdown={text} />
        )}
      </div>
    </div>
  )
}
