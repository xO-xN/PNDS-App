import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationStore } from '@/store/creation-store'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogTrigger,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'

export function AssistantHistoryControls({
  identity,
  children,
}: {
  identity: string
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const historyState = useAssistantStore(state => state.historyState)
  const busy = useAssistantStore(state => state.historyBusy)
  const saving = useAssistantStore(state => state.historySaving)
  const phase = useAssistantStore(state => state.phase)
  const historyError = useAssistantStore(state => state.historyError)
  const saveError = useAssistantStore(state => state.historySaveError)
  const projectName = useCreationStore(
    state => state.workspace?.project.name ?? ''
  )
  const [reloadOwner, setReloadOwner] = useState<string | null>(null)
  const updating = busy || saving || phase !== 'idle'
  const status =
    historyState === 'loading'
      ? t('assistant.history.loading')
      : historyError || saveError
        ? null
        : updating
          ? t('assistant.history.saving')
          : historyState === 'ready'
            ? t('assistant.history.saved')
            : null
  return (
    <div className="creation-assistant-header shrink-0 border-b border-(--pnds-border) px-3 py-2 text-xs">
      <div className="flex min-w-0 items-center gap-1">
        {children}
        {status && (
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={status}
            className="sr-only"
          >
            {status}
          </span>
        )}
      </div>
      {historyError && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-destructive">
            {t('assistant.history.operationFailed')}{' '}
            {t(
              historyState === 'error' && historyError === 'tooLarge'
                ? 'assistant.history.loadTooLarge'
                : `assistant.history.error.${historyError}`
            )}
          </p>
          {historyState === 'error' && (
            <Button
              size="sm"
              variant="outline"
              disabled={busy}
              onClick={() => void useAssistantStore.getState().retryHistory()}
            >
              {t('assistant.history.reload')}
            </Button>
          )}
        </div>
      )}
      {saveError && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-destructive">
            {t('assistant.history.saveFailed')}{' '}
            {t(
              saveError === 'invalidFormat'
                ? 'assistant.history.saveInvalidFormat'
                : `assistant.history.error.${saveError}`
            )}
          </p>
          {saveError === 'staleHistory' ? (
            <AlertDialog
              open={reloadOwner === identity}
              onOpenChange={open => setReloadOwner(open ? identity : null)}
            >
              <AlertDialogTrigger asChild>
                <Button size="sm" variant="outline" disabled={busy || saving}>
                  {t('assistant.history.reloadSaved')}
                </Button>
              </AlertDialogTrigger>
              <AlertDialogContent>
                <AlertDialogHeader>
                  <AlertDialogTitle>
                    {t('assistant.history.reloadTitle', {
                      project: projectName,
                    })}
                  </AlertDialogTitle>
                  <AlertDialogDescription>
                    {t('assistant.history.reloadDescription')}
                  </AlertDialogDescription>
                </AlertDialogHeader>
                <AlertDialogFooter>
                  <AlertDialogCancel>{t('close.cancel')}</AlertDialogCancel>
                  <AlertDialogAction
                    disabled={busy}
                    onClick={() => {
                      if (
                        reloadOwner === identity &&
                        useAssistantStore.getState().owner === identity
                      )
                        void useAssistantStore.getState().retryHistory()
                    }}
                  >
                    {t('assistant.history.reloadConfirm')}
                  </AlertDialogAction>
                </AlertDialogFooter>
              </AlertDialogContent>
            </AlertDialog>
          ) : saveError !== 'tooLarge' ? (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || saving}
              onClick={() => void useAssistantStore.getState().persistHistory()}
            >
              {t('assistant.history.retrySave')}
            </Button>
          ) : null}
        </div>
      )}
    </div>
  )
}
