import { useState } from 'react'
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
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { CreationErrorNotice } from './CreationErrorNotice'

function TextDifference({ before, after }: { before: string; after: string }) {
  const { t } = useTranslation()
  const oldLines = before.split('\n')
  const newLines = after.split('\n')
  let start = 0
  while (
    start < oldLines.length &&
    start < newLines.length &&
    oldLines[start] === newLines[start]
  )
    start++
  let end = 0
  while (
    end < oldLines.length - start &&
    end < newLines.length - start &&
    oldLines[oldLines.length - end - 1] === newLines[newLines.length - end - 1]
  )
    end++
  return (
    <pre
      dir="ltr"
      aria-label={t('creation.change.diff')}
      className="max-h-80 overflow-auto whitespace-pre-wrap break-words rounded border border-(--pnds-border) p-3 font-mono text-xs"
    >
      <span>{`@@ ${start + 1} @@\n`}</span>
      <del className="block">
        {oldLines
          .slice(start, oldLines.length - end)
          .map(line => `-${line}`)
          .join('\n')}
      </del>
      <ins className="block">
        {newLines
          .slice(start, newLines.length - end)
          .map(line => `+${line}`)
          .join('\n')}
      </ins>
    </pre>
  )
}

/** Review is a captured candidate. The store refuses changed drafts or disk
 * baselines; the backend rechecks actual disk bytes before writing/restoring. */
export function CreationFileChangeControls({
  identity,
  path,
}: {
  identity: string
  path: string
}) {
  const { t } = useTranslation()
  const draft = useCreationFilesStore(state => state.drafts[path])
  const saved = useCreationFilesStore(state => state.lastChange)
  const busy = useCreationFilesStore(state => state.changeBusy)
  const error = useCreationFilesStore(state => state.changeError)
  const [review, setReview] = useState<{
    identity: string
    path: string
    before: string
    after: string
    version: string
  } | null>(null)
  const [undone, setUndone] = useState(false)
  const current = saved?.path === path ? saved : null
  const candidate =
    review?.identity === identity && review.path === path ? review : null
  const reviewCurrent =
    !!candidate &&
    !!draft &&
    candidate.before === draft.diskText &&
    candidate.after === draft.text &&
    candidate.version === draft.diskVersion &&
    !draft.diskChanged &&
    !draft.conflict
  return (
    <div className="space-y-2">
      <Button
        size="sm"
        variant="outline"
        disabled={
          !draft ||
          !isDraftDirty(draft) ||
          !!draft.conflict ||
          draft.diskChanged ||
          draft.saving ||
          busy
        }
        onClick={() => {
          if (!draft) return
          setUndone(false)
          setReview({
            identity,
            path,
            before: draft.diskText,
            after: draft.text,
            version: draft.diskVersion,
          })
        }}
      >
        {t('creation.change.review')}
      </Button>
      {current && (
        <details open className="space-y-2">
          <summary>{t('creation.change.saved')}</summary>
          <TextDifference
            before={current.beforeText}
            after={current.afterText}
          />
          <p className="text-xs">{t('creation.change.scope')}</p>
          <Button
            size="sm"
            variant="outline"
            disabled={
              busy ||
              !draft ||
              isDraftDirty(draft) ||
              draft.diskVersion !== current.afterVersion
            }
            onClick={async () => {
              await useCreationFilesStore
                .getState()
                .undoChange(identity, current.id)
              if (
                !useCreationFilesStore.getState().lastChange &&
                !useCreationFilesStore.getState().changeError
              )
                setUndone(true)
            }}
          >
            {t('creation.change.undo')}
          </Button>
        </details>
      )}
      {undone && <p role="status">{t('creation.change.undone')}</p>}
      {error && !candidate && <CreationErrorNotice error={error} />}
      <Dialog
        open={!!candidate}
        onOpenChange={open => {
          if (!open && !busy) setReview(null)
        }}
      >
        <DialogContent showCloseButton={false}>
          <DialogHeader>
            <DialogTitle>{t('creation.change.review')}</DialogTitle>
            <DialogDescription>{t('creation.change.scope')}</DialogDescription>
          </DialogHeader>
          {candidate && (
            <TextDifference before={candidate.before} after={candidate.after} />
          )}
          {!reviewCurrent && <p role="status">{t('creation.change.stale')}</p>}
          {error && <CreationErrorNotice error={error} />}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => setReview(null)}
            >
              {t('creation.cancel')}
            </Button>
            <Button
              disabled={busy || !reviewCurrent}
              onClick={async () => {
                if (!candidate) return
                if (
                  await useCreationFilesStore
                    .getState()
                    .saveReviewed(
                      path,
                      candidate.before,
                      candidate.after,
                      candidate.version,
                      candidate.identity
                    )
                )
                  setReview(null)
              }}
            >
              {t('creation.change.save')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
