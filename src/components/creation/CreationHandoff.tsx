import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { toast } from 'sonner'
import { useTranslation } from 'react-i18next'
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
import {
  HANDOFF_PATH,
  useCreationHandoffStore,
} from '@/store/creation-handoff-store'
import {
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { CreationErrorNotice } from './CreationErrorNotice'
import { cn } from '@/lib/utils'

export function CreationHandoff({
  editable,
  exists,
  className,
  menuOnly = false,
}: {
  editable: boolean
  exists: boolean
  className?: string
  menuOnly?: boolean
}) {
  const { t } = useTranslation()
  const pending = useCreationHandoffStore(state => state.pending)
  const activeId = useCreationHandoffStore(state => state.activeId)
  const document = useCreationHandoffStore(state => state.document)
  const busy = useCreationHandoffStore(state => state.busy)
  const conflict = useCreationHandoffStore(state => state.conflict)
  const error = useCreationHandoffStore(state => state.error)
  const recorded = useCreationHandoffStore(state => state.recorded)
  const draftChoice = useCreationHandoffStore(state => state.draftChoice)
  const drafts = useCreationFilesStore(state => state.drafts)
  const review = useCreationHandoffStore(state => state.review)
  const receipt = useCreationHandoffStore(state => state.receipt)
  const task = pending.find(item => item.task.id === activeId)?.task
  return (
    <div
      className={cn(
        !menuOnly &&
          'space-y-2 border-b border-(--pnds-border) p-4 text-start text-xs',
        className
      )}
    >
      <div hidden={menuOnly} className="flex flex-wrap items-center gap-2">
        {exists && (
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              useCreationFilesStore.getState().setActivePath(HANDOFF_PATH)
              useCreationTestStore.getState().setTab('file')
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
            <Button
              key={item.task.id}
              size="sm"
              variant="outline"
              title={item.task.intent}
              onClick={() =>
                void useCreationHandoffStore.getState().open(item.task.id)
              }
            >
              {t('creation.handoff.sync')}
            </Button>
          ))}
      </div>
      {recorded && <p role="status">{t('creation.handoff.recorded')}</p>}
      {receipt?.baselineError && (
        <div role="alert">
          {t(
            receipt.taskRecorded
              ? 'creation.handoff.baselineFailed'
              : 'creation.handoff.taskFailed'
          )}
          <CreationErrorNotice error={receipt.baselineError} />
        </div>
      )}
      {receipt?.baselineId &&
        !receipt.baselineError &&
        receipt.taskRecorded && (
          <p role="status">{t('creation.handoff.baselineReady')}</p>
        )}
      {receipt?.taskRecorded && (
        <div className="space-y-2 text-xs">
          <p>
            {t('creation.handoff.revision', {
              id: receipt.task.id,
              revision: receipt.revision,
            })}
          </p>
          <Button
            size="sm"
            variant="outline"
            onClick={() =>
              void writeText(receipt.instructions)
                .then(() => toast.success(t('creation.handoff.copied')))
                .catch(() => toast.error(t('toast.error.generic')))
            }
          >
            {t('creation.handoff.copy')}
          </Button>
        </div>
      )}
      <Dialog
        open={!!task}
        onOpenChange={open => {
          if (!open) useCreationHandoffStore.getState().cancel()
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="max-h-[85vh] overflow-auto"
        >
          <DialogHeader>
            <DialogTitle>{t('creation.handoff.title')}</DialogTitle>
            <DialogDescription>{t('creation.handoff.hint')}</DialogDescription>
          </DialogHeader>
          {task && (
            <fieldset disabled={busy} className="grid gap-3">
              {(['intent', 'files', 'acceptance'] as const).map(field => (
                <label key={field} className="grid gap-1 text-sm">
                  <span>{t(`creation.handoff.${field}`)}</span>
                  <textarea
                    className="creation-editor-textarea pnds-focus-ring min-h-24"
                    value={
                      field === 'files' ? task.files.join('\n') : task[field]
                    }
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
              <label className="grid gap-1 text-sm">
                <span>{t('creation.handoff.status')}</span>
                <Select
                  value={task.status}
                  disabled={busy}
                  onValueChange={status =>
                    useCreationHandoffStore.getState().edit({ status })
                  }
                >
                  <SelectTrigger aria-label={t('creation.handoff.status')}>
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {['pending', 'in-progress', 'blocked'].map(status => (
                      <SelectItem key={status} value={status}>
                        {t(
                          `creation.handoff.status.${status === 'in-progress' ? 'inProgress' : status}`
                        )}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
            </fieldset>
          )}
          {draftChoice && (
            <div
              role="group"
              aria-label={t('creation.handoff.draftTitle')}
              className="space-y-2 text-sm"
            >
              <p>{t('creation.handoff.draftHint')}</p>
              <ul>
                {Object.entries(drafts)
                  .filter(([, draft]) => isDraftDirty(draft))
                  .map(([path]) => (
                    <li key={path}>{path}</li>
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
            <p role="status" className="break-all text-xs">
              {t('creation.handoff.reviewHint')}{' '}
              {t('creation.handoff.revision', {
                id: review.task.id,
                revision: review.revision,
              })}
            </p>
          )}
          {busy && <p role="status">{t('creation.loading')}</p>}
          {error && <CreationErrorNotice error={error} />}
          {conflict && <p role="alert">{t('creation.handoff.conflict')}</p>}
          {document && (
            <details open={conflict}>
              <summary className="pnds-focus-ring">
                {t('creation.handoff.diskPreview')}
              </summary>
              <pre dir="auto" className="creation-conflict-preview">
                {document.text}
              </pre>
            </details>
          )}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
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
                  ? 'creation.handoff.confirmReviewed'
                  : conflict
                    ? 'creation.handoff.confirmAppend'
                    : 'creation.handoff.record'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
