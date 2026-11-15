import { TooltipHint } from '@/components/ui/tooltip'
import { HandoffOperationProgressView } from './HandoffOperationProgressView'
import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import {
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { CreationErrorNotice } from './CreationErrorNotice'
import { cn } from '@/lib/utils'
import { useCreationStore } from '@/store/creation-store'
import { handoffEntries } from '@/lib/creation-handoff-document'
import type { HandoffTask } from '@/lib/tauri-bindings'
import { CreationHandoffReceipt } from './CreationHandoffReceipt'

function HandoffMarkdown({ text }: { text: string }) {
  return (
    <div className="assistant-markdown creation-handoff-prose">
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        components={{
          img: ({ alt }) => <span>{alt}</span>,
          a: ({ children }) => <span>{children}</span>,
        }}
      >
        {text}
      </ReactMarkdown>
    </div>
  )
}

function HandoffTaskContent({
  task,
  busy,
  reviewed,
}: {
  task: HandoffTask
  busy: boolean
  reviewed: boolean
}) {
  const { t } = useTranslation()
  const [editing, setEditing] = useState(!task.intent.trim())
  return (
    <section className="creation-handoff-task">
      <div className="creation-handoff-section-heading">
        <h3>{t('creation.handoff.taskPreview')}</h3>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          disabled={busy}
          aria-pressed={!reviewed && editing}
          onClick={() => {
            if (reviewed) {
              useCreationHandoffStore.getState().edit({})
              setEditing(true)
            } else setEditing(value => !value)
          }}
        >
          {t(
            !reviewed && editing
              ? 'creation.handoff.readTask'
              : 'creation.handoff.editTask'
          )}
        </Button>
      </div>
      {reviewed ? null : editing ? (
        <fieldset disabled={busy} className="creation-handoff-fields">
          {(['intent', 'files', 'acceptance'] as const).map(field => (
            <label key={field} className="creation-handoff-field">
              <span>{t(`creation.handoff.${field}`)}</span>
              <textarea
                className={`pnds-focus-ring creation-handoff-input creation-handoff-input-${field}`}
                value={field === 'files' ? task.files.join('\n') : task[field]}
                rows={field === 'files' ? 4 : 8}
                onChange={event =>
                  useCreationHandoffStore.getState().edit({
                    [field]:
                      field === 'files'
                        ? event.target.value.split('\n')
                        : event.target.value,
                  })
                }
              />
            </label>
          ))}
        </fieldset>
      ) : (
        <div className="creation-handoff-task-sections">
          <section aria-label={t('creation.handoff.intent')}>
            <h4>{t('creation.handoff.intent')}</h4>
            <HandoffMarkdown text={task.intent} />
          </section>
          <details className="creation-handoff-files">
            <summary className="pnds-focus-ring">
              {t('creation.handoff.fileCount', { count: task.files.length })}
            </summary>
            <ul>
              {task.files.map((path, index) => (
                <li key={`${path}-${index}`}>
                  <code>{path}</code>
                </li>
              ))}
            </ul>
          </details>
          <section aria-label={t('creation.handoff.acceptance')}>
            <h4>{t('creation.handoff.acceptance')}</h4>
            <HandoffMarkdown text={task.acceptance} />
          </section>
        </div>
      )}
    </section>
  )
}

export function CreationHandoff({
  editable,
  exists,
  className,
  menuOnly = false,
  onCloseAutoFocus,
}: {
  editable: boolean
  exists: boolean
  className?: string
  menuOnly?: boolean
  onCloseAutoFocus?: (event: Event) => void
}) {
  const { t } = useTranslation()
  const pending = useCreationHandoffStore(state => state.pending)
  const activeId = useCreationHandoffStore(state => state.activeId)
  const document = useCreationHandoffStore(state => state.document)
  const busy = useCreationHandoffStore(state => state.busy)
  const conflict = useCreationHandoffStore(state => state.conflict)
  const error = useCreationHandoffStore(state => state.error)
  const operationProgress = useCreationHandoffStore(
    state => state.operationProgress
  )
  const draftChoice = useCreationHandoffStore(state => state.draftChoice)
  const drafts = useCreationFilesStore(state => state.drafts)
  const review = useCreationHandoffStore(state => state.review)
  const documentEdit = useCreationHandoffStore(state => state.documentEdit)
  const project = useCreationStore(state => state.workspace?.project)
  const pendingTask = pending.find(item => item.task.id === activeId)
  const task = pendingTask?.task
  const entries = document ? handoffEntries(document.text) : []
  const historical =
    !!pendingTask?.recordedSource &&
    !!document &&
    !document.text.includes(`<!-- pnds-task:${task?.id} -->`)
  return (
    <>
      {!menuOnly && (
        <div
          className={cn(
            'space-y-2 border-b border-(--pnds-border) p-4 text-start text-xs',
            className
          )}
        >
          <div className="flex flex-wrap items-center gap-2">
            {exists && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  useCreationReadingStore.getState().showHandoff()
                }}
              >
                {t('creation.handoff.view')}
              </Button>
            )}
            {editable && (
              <Button
                size="sm"
                variant="outline"
                onClick={() => void useCreationHandoffStore.getState().open()}
              >
                {t('creation.handoff.add')}
              </Button>
            )}
            {pending
              .filter(item => item.readme)
              .map(item => (
                <TooltipHint key={item.task.id} content={item.task.intent}>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() =>
                      void useCreationHandoffStore.getState().open(item.task.id)
                    }
                  >
                    {t('creation.handoff.sync')}
                  </Button>
                </TooltipHint>
              ))}
          </div>
          <CreationHandoffReceipt />
        </div>
      )}
      <Dialog
        open={!!task}
        onOpenChange={open => {
          if (!open) useCreationHandoffStore.getState().cancel()
        }}
      >
        <DialogContent
          onCloseAutoFocus={onCloseAutoFocus}
          showCloseButton={false}
          className="creation-handoff-dialog flex max-h-[85vh] flex-col gap-0 overflow-hidden p-0 text-start sm:max-w-3xl"
        >
          <DialogHeader className="creation-handoff-header">
            <div className="creation-handoff-heading-row">
              <DialogTitle>{t('creation.handoff.title')}</DialogTitle>
              <span className="creation-handoff-pending">
                {t(
                  historical
                    ? 'creation.handoff.recordedTask'
                    : 'creation.handoff.awaitingWork'
                )}
              </span>
            </div>
            <DialogDescription>{t('creation.handoff.hint')}</DialogDescription>
            <div className="creation-handoff-location">
              <span>{project?.name}</span>
              <code>docs/creator-handoff.md</code>
            </div>
          </DialogHeader>
          <div className="creation-handoff-body" aria-busy={busy}>
            {task && (
              <>
                {historical && (
                  <div className="creation-handoff-notice space-y-3">
                    <p>{t('creation.handoff.inactiveRecord')}</p>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={busy}
                      onClick={() =>
                        useCreationHandoffStore.getState().replaceTaskId('')
                      }
                    >
                      {t('creation.handoff.createFromRecord')}
                    </Button>
                  </div>
                )}
                {!historical && entries.length > 0 && (
                  <label className="creation-handoff-target">
                    <span>{t('creation.handoff.taskTarget')}</span>
                    <Select
                      value={
                        entries.some(entry => entry.id === task.id)
                          ? task.id
                          : '__new__'
                      }
                      disabled={busy}
                      onValueChange={id =>
                        useCreationHandoffStore
                          .getState()
                          .replaceTaskId(id === '__new__' ? '' : id)
                      }
                    >
                      <SelectTrigger
                        aria-label={t('creation.handoff.taskTarget')}
                        className="w-full min-w-0"
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent className="max-w-[min(42rem,calc(100vw-4rem))]">
                        <SelectItem value="__new__">
                          {t('creation.handoff.newTask')}
                        </SelectItem>
                        {entries.map(entry => (
                          <SelectItem key={entry.id} value={entry.id}>
                            <span className="line-clamp-2 break-words whitespace-normal">
                              {t('creation.handoff.updateTask', {
                                title: entry.title,
                              })}
                            </span>
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <span className="creation-handoff-quiet">
                      {t('creation.handoff.taskTargetHint')}
                    </span>
                  </label>
                )}
                <HandoffTaskContent
                  key={task.id}
                  task={task}
                  busy={busy || historical}
                  reviewed={!!review?.plannedText}
                />
              </>
            )}
            {document && !historical && (
              <details
                className="creation-handoff-manage"
                open={conflict || undefined}
              >
                <summary className="pnds-focus-ring">
                  {t('creation.handoff.manageContent')}
                </summary>
                <p className="creation-handoff-quiet">
                  {t('creation.handoff.manageHint')}
                </p>
                <label className="creation-handoff-field">
                  <span>{t('creation.handoff.activeContent')}</span>
                  <textarea
                    className="pnds-focus-ring creation-handoff-input creation-handoff-input-current"
                    disabled={busy}
                    rows={10}
                    value={documentEdit ?? document.text}
                    onChange={event =>
                      useCreationHandoffStore
                        .getState()
                        .editDocument(event.target.value)
                    }
                  />
                </label>
                {documentEdit !== null && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    className="mt-3"
                    disabled={busy}
                    onClick={() =>
                      useCreationHandoffStore.getState().resetDocumentEdit()
                    }
                  >
                    {t('creation.handoff.resetContent')}
                  </Button>
                )}
              </details>
            )}
            {draftChoice && (
              <div
                role="group"
                aria-label={t('creation.handoff.draftTitle')}
                className="creation-handoff-notice space-y-3"
              >
                <h3>{t('creation.handoff.draftTitle')}</h3>
                <p>{t('creation.handoff.draftHint')}</p>
                <ul className="creation-handoff-dirty-files">
                  {Object.entries(drafts)
                    .filter(([, draft]) => isDraftDirty(draft))
                    .map(([path]) => (
                      <li key={path}>
                        <code>{path}</code>
                      </li>
                    ))}
                </ul>
                <div className="flex flex-wrap gap-2">
                  <Button
                    disabled={busy}
                    onClick={() =>
                      void useCreationHandoffStore.getState().record('save')
                    }
                  >
                    {t('creation.handoff.saveFirst')}
                  </Button>
                  <Button
                    variant="outline"
                    disabled={busy}
                    onClick={() =>
                      void useCreationHandoffStore.getState().record('saved')
                    }
                  >
                    {t('creation.handoff.savedOnly')}
                  </Button>
                </div>
              </div>
            )}
            {review && (
              <section
                className="creation-handoff-final-preview"
                aria-label={t('creation.handoff.writePreview')}
              >
                <div className="creation-handoff-section-heading">
                  <h3>{t('creation.handoff.writePreview')}</h3>
                  <span className="creation-handoff-quiet" role="status">
                    {t('creation.handoff.readyToWrite')}
                  </span>
                </div>
                <p className="creation-handoff-quiet">
                  {t('creation.handoff.reviewHint')}
                </p>
                {review.archivePath && (
                  <p className="creation-handoff-archive-note">
                    {t('creation.handoff.archivePrevious')}{' '}
                    <code>{review.archivePath}</code>
                  </p>
                )}
                {review.plannedText && (
                  <HandoffMarkdown text={review.plannedText} />
                )}
              </section>
            )}
            {busy &&
              (operationProgress ? (
                <HandoffOperationProgressView progress={operationProgress} />
              ) : (
                <p role="status" className="creation-handoff-quiet">
                  {t('creation.loading')}
                </p>
              ))}
            {error && <CreationErrorNotice error={error} />}
            {conflict && (
              <p role="alert" className="creation-handoff-notice">
                {t('creation.handoff.conflict')}
              </p>
            )}
          </div>
          <DialogFooter className="creation-handoff-footer">
            <p className="creation-handoff-footer-note" hidden={historical}>
              {t(
                review
                  ? 'creation.handoff.confirmHint'
                  : 'creation.handoff.previewHint'
              )}
            </p>
            <div className="flex shrink-0 flex-wrap justify-end gap-2">
              <Button
                variant="outline"
                disabled={busy && !operationProgress?.cancellable}
                onClick={() => useCreationHandoffStore.getState().cancel()}
              >
                {t('creation.cancel')}
              </Button>
              {error && !document && (
                <Button
                  variant="outline"
                  disabled={busy}
                  onClick={() =>
                    void useCreationHandoffStore
                      .getState()
                      .open(activeId ?? undefined)
                  }
                >
                  {t('creation.handoff.retry')}
                </Button>
              )}
              <Button
                disabled={
                  busy ||
                  historical ||
                  draftChoice ||
                  !document ||
                  !task?.intent.trim() ||
                  !task.acceptance.trim() ||
                  !task.files.some(file => file.trim())
                }
                onClick={() => void useCreationHandoffStore.getState().record()}
              >
                {t(
                  review
                    ? 'creation.handoff.confirmWrite'
                    : 'creation.handoff.previewWrite'
                )}
              </Button>
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
