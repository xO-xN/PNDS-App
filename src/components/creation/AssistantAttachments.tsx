import { useSyncExternalStore } from 'react'
import { useTranslation } from 'react-i18next'
import {
  useAssistantProjectStore,
  type PendingAssistantAttachment,
} from '@/store/assistant-project-store'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { Button } from '@/components/ui/button'
import { useCreationStore } from '@/store/creation-store'

function Attachment({ item }: { item: PendingAssistantAttachment }) {
  const { t } = useTranslation()
  const editorState = useSyncExternalStore(
    item.buffer.subscribe,
    item.buffer.getSnapshot
  )
  const draftVersion = useCreationFilesStore(
    state =>
      state.drafts[item.snapshot.path]?.conflict?.version ??
      state.drafts[item.snapshot.path]?.diskVersion
  )
  const savedVersion = useAssistantProjectStore(state =>
    state.snapshot !== item.inventoryAtCapture
      ? state.snapshot?.files.find(file => file.path === item.snapshot.path)
          ?.version
      : null
  )
  const phase = useAssistantStore(state => state.phase)
  const { snapshot } = item
  const stale =
    editorState.doc.toString() !== item.document.replace(/\r\n|\r/g, '\n') ||
    item.diskVersionAtCapture !== item.baseVersion ||
    (!!savedVersion && savedVersion !== item.baseVersion) ||
    (!!draftVersion && draftVersion !== item.baseVersion)
  return (
    <div className="rounded-md border border-(--pnds-border) p-2 text-xs">
      <details>
        <summary className="pnds-focus-ring break-all">
          {t(`assistant.history.source.${snapshot.source}`)} · {snapshot.path}:
          {snapshot.startLine}–{snapshot.endLine}
        </summary>
        <p className="my-1 break-all">
          {t('assistant.history.version', { version: snapshot.version })}
        </p>
        {snapshot.proposalId && (
          <p>
            {t('assistant.attachment.proposal', {
              id: snapshot.proposalId,
              revision: snapshot.candidateRevision,
            })}
          </p>
        )}
        <pre
          tabIndex={0}
          className="pnds-focus-ring max-h-40 overflow-auto whitespace-pre-wrap"
          dir="ltr"
        >
          {snapshot.text}
        </pre>
      </details>
      <p role="status" className="mt-1 text-muted-foreground">
        {t(
          stale ? 'assistant.attachment.stale' : 'assistant.attachment.snapshot'
        )}
      </p>
      <Button
        size="sm"
        variant="ghost"
        disabled={phase !== 'idle'}
        onClick={() =>
          useAssistantProjectStore.getState().removeAttachment(snapshot.id)
        }
      >
        {t('assistant.attachment.remove', { path: snapshot.path })}
      </Button>
    </div>
  )
}

export function AssistantAttachments() {
  const { t } = useTranslation()
  const attachments = useAssistantProjectStore(state => state.attachments)
  const error = useAssistantProjectStore(state => state.attachmentError)
  const config = useAssistantStore(state => state.modelConfig)
  const project = useCreationStore(state => state.workspace?.project.name)
  return (
    <>
      {error && (
        <p role="alert" className="mb-2 text-xs text-destructive">
          {t('assistant.error.attachmentExcluded')}
        </p>
      )}
      {attachments.length > 0 && (
        <section
          aria-label={t('assistant.attachment.title')}
          className="mb-2 flex max-h-64 flex-col gap-2 overflow-auto"
        >
          <p className="text-xs">{project}</p>
          <p className="break-all text-xs">
            {t('assistant.attachment.service', {
              model: config?.model ?? '',
              service: config?.baseUrl ?? '',
            })}
          </p>
          {attachments.map(item => (
            <Attachment key={item.snapshot.id} item={item} />
          ))}
        </section>
      )}
    </>
  )
}
