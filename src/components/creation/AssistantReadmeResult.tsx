import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  chineseReadme,
  englishReadme,
  englishReadmeVariant,
} from '@/lib/assistant-readme-skill'
import type { AssistantReadmeResult as ReadmeResult } from '@/lib/tauri-bindings'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationPendingStore } from '@/store/creation-pending-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'

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
  const open = async (path: string, locale: 'en' | 'zh-CN') => {
    const owns = () =>
      useCreationStore.getState().workspace?.project.identity === identity
    if (!owns()) return
    if (
      !useCreationStore
        .getState()
        .workspace?.files.some(file => file.path === path)
    )
      await useCreationFilesStore.getState().synchronizeSaved(identity)
    if (!owns()) return
    if (
      !useCreationStore
        .getState()
        .workspace?.files.some(file => file.path === path)
    ) {
      toast.error(t('assistant.readme.unavailable'))
      return
    }
    useCreationPendingStore.setState({ activeId: null })
    useCreationFilesStore.getState().setReadmeLocale(locale)
    useCreationFilesStore.getState().setActivePath(path)
    useCreationTestStore.getState().setTab('file')
    useCreationReadingStore.getState().showFile(messageId)
  }
  if (result.variant === 'cancel')
    return <p className="text-sm">{t('assistant.readme.cancelled')}</p>
  const paths = [
    {
      path: englishReadme,
      saved: result.englishSaved,
      locale: 'en',
      preview: 'previewEnglish',
    },
    {
      path: chineseReadme,
      saved: result.chineseSaved,
      locale: 'zh-CN',
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
                  onClick={() => void open(item.path, item.locale)}
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
