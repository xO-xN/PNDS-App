import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { TextBuffer } from '@/lib/text-buffer'
import {
  pendingDraftDirty,
  useCreationPendingStore,
} from '@/store/creation-pending-store'
const TextEditor = lazy(() =>
  import('./TextEditor').then(module => ({ default: module.TextEditor }))
)

export function CreationPendingEditor({
  id,
  identity,
}: {
  id: string
  identity: string
}) {
  const { t } = useTranslation()
  const draft = useCreationPendingStore(state => state.drafts[id])
  const removing = useCreationPendingStore(state => state.removing.has(id))
  const [renaming, setRenaming] = useState(false)
  const [name, setName] = useState('')
  const [buffer] = useState(
    () => draft?.editor ?? new TextBuffer(draft?.text ?? '', draft?.name ?? '')
  )
  const hasDraft = !!draft
  useEffect(() => {
    if (hasDraft && useCreationPendingStore.getState().identity === identity)
      useCreationPendingStore.getState().attachEditor(id, buffer)
  }, [id, identity, buffer, hasDraft])
  if (!draft)
    return (
      <p role="status" className="p-4 text-sm">
        {t('creation.loading')}
      </p>
    )
  return (
    <section
      className="flex min-h-0 flex-1 flex-col"
      aria-label={t('creation.pending.editor')}
    >
      <div className="flex flex-wrap items-center gap-2 border-b border-(--pnds-border) px-3 py-2">
        {renaming ? (
          <form
            onSubmit={event => {
              event.preventDefault()
              void useCreationPendingStore
                .getState()
                .rename(id, name)
                .then(saved => {
                  if (saved) setRenaming(false)
                })
            }}
          >
            <Input
              autoFocus
              value={name}
              disabled={draft.saving}
              aria-label={t('creation.pending.name')}
              onChange={event => setName(event.target.value)}
              onKeyDown={event => {
                if (event.nativeEvent.isComposing && event.key === 'Enter')
                  event.preventDefault()
                if (event.key === 'Escape') setRenaming(false)
              }}
            />
          </form>
        ) : (
          <strong className="min-w-0 flex-1 truncate text-sm">
            {draft.name || t('creation.pending.untitled')}
          </strong>
        )}
        <Button
          size="sm"
          disabled={draft.saving}
          onClick={() => void useCreationPendingStore.getState().save(id)}
        >
          {t('creation.save')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={draft.saving}
          onClick={() => {
            setName(draft.name)
            setRenaming(true)
          }}
        >
          {t('creation.pending.rename')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={!draft.saved || draft.saving}
          onClick={() => void useCreationPendingStore.getState().reveal(id)}
        >
          {t('creation.pending.reveal')}
        </Button>
        <Button
          variant="ghost"
          size="sm"
          disabled={draft.saving}
          onClick={() => void useCreationPendingStore.getState().remove(id)}
        >
          {t('creation.pending.delete')}
        </Button>
      </div>
      {draft.error && (
        <p role="alert" className="px-3 py-2 text-xs text-(--pnds-danger)">
          {t(`creation.materials.error.${draft.error}`)}
        </p>
      )}
      {draft.conflict && (
        <div className="space-y-2 border-b p-3 text-xs">
          <p>{t('creation.pending.externalConflict')}</p>
          <p>
            {t('creation.pending.externalSavedName', {
              name: draft.conflict.document.name,
            })}
          </p>
          <details>
            <summary>{t('creation.pending.diskContent')}</summary>
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap">
              {draft.conflict.text}
            </pre>
          </details>
          <Button
            variant="outline"
            size="sm"
            onClick={() => useCreationPendingStore.getState().adoptExternal(id)}
          >
            {t('creation.pending.reload')}
          </Button>
          <Button
            variant="outline"
            size="sm"
            onClick={() =>
              void useCreationPendingStore
                .getState()
                .save(id, draft.conflict?.document.version)
            }
          >
            {t('creation.pending.overwrite')}
          </Button>
        </div>
      )}
      <div
        data-file-draft=""
        data-pending-editor=""
        className="creation-file-code flex min-h-0 flex-1 flex-col"
      >
        <Suspense fallback={<p role="status">{t('creation.loading')}</p>}>
          <TextEditor
            buffer={buffer}
            path={draft.name}
            value={draft.text}
            readOnly={removing}
            resetKey={draft.editorRevision}
            onChange={text => {
              const current = useCreationPendingStore.getState()
              if (current.identity === identity) current.edit(id, text)
            }}
            statusContent={
              <span>
                {t(
                  draft.saving
                    ? 'creation.saving'
                    : pendingDraftDirty(draft) || !draft.saved
                      ? 'creation.unsaved'
                      : 'creation.saved'
                )}
              </span>
            }
          />
        </Suspense>
      </div>
    </section>
  )
}
