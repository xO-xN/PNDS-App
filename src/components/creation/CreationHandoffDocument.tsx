import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useCreationStore } from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { HANDOFF_PATH } from '@/store/creation-handoff-store'
import { CreationFileEditor } from './CreationFileEditor'
import { CreationErrorNotice } from './CreationErrorNotice'
import type { CreationError } from '@/lib/tauri-bindings'
import { Button } from '@/components/ui/button'
import { CreationHandoffReceipt } from './CreationHandoffReceipt'

export function CreationHandoffDocument({
  identity,
  editable,
}: {
  identity: string
  editable: boolean
}) {
  const { t } = useTranslation()
  const file = useCreationStore(state =>
    state.workspace?.files.find(file => file.path === HANDOFF_PATH)
  )
  const directories = useCreationStore(state => state.workspace?.directories)
  const draft = useCreationFilesStore(state => state.drafts[HANDOFF_PATH])
  const [error, setError] = useState<CreationError | null>(null)
  const busy = useCreationFilesStore(state => state.creating)
  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <CreationHandoffReceipt className="shrink-0 border-b border-(--pnds-border) p-3" />
      {file || draft ? (
        <CreationFileEditor
          identity={identity}
          file={
            file ?? {
              path: HANDOFF_PATH,
              kind: 'text',
              category: 'system',
              size: 0,
            }
          }
          editable={editable}
        />
      ) : (
        <div className="creation-handoff-empty">
          <h2>{t('creation.handoff.view')}</h2>
          <p>{t('creation.handoff.emptyDocument')}</p>
          {error && <CreationErrorNotice error={error} />}
          <Button
            disabled={!editable || busy}
            onClick={async () => {
              setError(null)
              if (!directories?.includes('docs')) {
                const directory = await useCreationFilesStore
                  .getState()
                  .createDirectory('docs')
                if (!directory) return
                if (
                  directory.status === 'error' &&
                  directory.error.code !== 'targetExists'
                ) {
                  setError(directory.error)
                  return
                }
              }
              if (
                useCreationStore.getState().workspace?.project.identity !==
                identity
              )
                return
              const previous = useCreationFilesStore.getState().activePath
              const result = await useCreationFilesStore
                .getState()
                .create(HANDOFF_PATH)
              if (
                useCreationStore.getState().workspace?.project.identity !==
                identity
              )
                return
              if (result?.status === 'error') setError(result.error)
              else if (result?.status === 'ok') {
                useCreationFilesStore.getState().setActivePath(previous)
                useCreationReadingStore.getState().showHandoff()
              }
            }}
          >
            {t('creation.handoff.createDocument')}
          </Button>
        </div>
      )}
    </div>
  )
}
