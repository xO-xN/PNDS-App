import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  chineseReadme,
  englishReadme,
  englishReadmeVariant,
} from '@/lib/assistant-readme-skill'
import type { AssistantReadmeResult as ReadmeResult } from '@/lib/tauri-bindings'
import { commands } from '@/lib/tauri-bindings'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useCreationStore } from '@/store/creation-store'
import { CreationReadme } from './CreationReadme'

function SavedReadmePreview({
  identity,
  path,
  root,
}: {
  identity: string
  path: string
  root: string
}) {
  const { t } = useTranslation()
  const [text, setText] = useState<string | null>()
  useEffect(() => {
    let current = true
    void commands.readCreationFile(identity, path).then(
      result => {
        if (current)
          setText(
            result.status === 'ok' && result.data.kind === 'text'
              ? result.data.text
              : null
          )
      },
      () => {
        if (current) setText(null)
      }
    )
    return () => {
      current = false
    }
  }, [identity, path])
  if (text === undefined)
    return (
      <p role="status" className="p-4">
        {t('creation.loading')}
      </p>
    )
  if (text === null)
    return (
      <p role="alert" className="p-4">
        {t('assistant.readme.unavailable')}
      </p>
    )
  return (
    <div className="creation-file-content creation-file-content-cover min-h-0 flex-1 p-4">
      <CreationReadme text={text} root={root} editable={false} />
    </div>
  )
}

export function AssistantReadmeResult({
  identity,
  messageId,
  result,
  finished,
}: {
  identity: string
  messageId: string
  result: ReadmeResult
  finished: boolean
}) {
  const { t } = useTranslation()
  const open = (path: string) => {
    const project = useCreationStore.getState().workspace?.project
    if (project?.identity !== identity) return
    useCreationReadingStore.getState().showExtension(
      {
        id: `saved-readme:${path}`,
        title: path,
        content: (
          <SavedReadmePreview
            key={crypto.randomUUID()}
            identity={identity}
            path={path}
            root={project.root}
          />
        ),
      },
      messageId
    )
  }
  if (result.variant === 'cancel')
    return <p className="text-sm">{t('assistant.readme.cancelled')}</p>
  const paths = [
    {
      path: englishReadme,
      saved: result.englishSaved,
      preview: 'previewEnglish',
    },
    {
      path: chineseReadme,
      saved: result.chineseSaved,
      preview: 'previewChinese',
    },
    ...(result.variant === 'sync'
      ? [{ path: englishReadmeVariant, saved: result.variantSaved }]
      : []),
  ] as const
  return (
    <section
      aria-label={t('assistant.readme.result')}
      className="my-3 space-y-2 text-sm"
    >
      <ul className="space-y-1">
        {paths
          .filter(item => item.saved || finished)
          .map(item => (
            <li key={item.path} className="flex flex-wrap items-center gap-2">
              <span>
                {t(
                  item.saved
                    ? 'assistant.readme.saved'
                    : 'assistant.readme.unsaved',
                  { path: item.path }
                )}
              </span>
              {item.saved && 'preview' in item && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => open(item.path)}
                >
                  {t(`assistant.readme.${item.preview}`)}
                </Button>
              )}
            </li>
          ))}
      </ul>
      {result.variant === 'keep' && <p>{t('assistant.readme.kept')}</p>}
    </section>
  )
}
