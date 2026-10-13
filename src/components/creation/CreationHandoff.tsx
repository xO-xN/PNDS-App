import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
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
import { useCreationFilesStore } from '@/store/creation-files-store'
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
                <select
                  className="pnds-focus-ring rounded border bg-(--pnds-card) p-2"
                  value={task.status}
                  onChange={event =>
                    useCreationHandoffStore
                      .getState()
                      .edit({ status: event.target.value })
                  }
                >
                  {['pending', 'in-progress', 'blocked'].map(status => (
                    <option key={status} value={status}>
                      {t(
                        `creation.handoff.status.${status === 'in-progress' ? 'inProgress' : status}`
                      )}
                    </option>
                  ))}
                </select>
              </label>
            </fieldset>
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
                !document ||
                !task?.intent.trim() ||
                !task.acceptance.trim() ||
                !task.files.some(file => file.trim())
              }
              onClick={() => void useCreationHandoffStore.getState().record()}
            >
              {t(
                conflict
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
