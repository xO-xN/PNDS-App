import { useState } from 'react'
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

export function AssistantHistoryControls({ identity }: { identity: string }) {
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
  const [confirmOwner, setConfirmOwner] = useState<string | null>(null)
  const [reloadOwner, setReloadOwner] = useState<string | null>(null)
  return (
    <div className="shrink-0 border-b border-(--pnds-border) px-4 py-2 text-xs">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p
          aria-live="polite"
          aria-atomic="true"
          role={historyState === 'loading' ? 'status' : undefined}
        >
          {historyState === 'loading'
            ? t('assistant.history.loading')
            : historyError || saveError
              ? null
              : busy || saving || phase !== 'idle'
                ? t('assistant.history.saving')
                : historyState === 'ready'
                  ? t('assistant.history.saved')
                  : null}
        </p>
        <AlertDialog
          open={confirmOwner === identity}
          onOpenChange={open => setConfirmOwner(open ? identity : null)}
        >
          <AlertDialogTrigger asChild>
            <Button
              size="sm"
              variant="ghost"
              disabled={historyState === 'loading' || busy}
            >
              {t('assistant.history.clear')}
            </Button>
          </AlertDialogTrigger>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>
                {t('assistant.history.clearTitle', { project: projectName })}
              </AlertDialogTitle>
              <AlertDialogDescription>
                {t('assistant.history.clearDescription')}
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel>{t('close.cancel')}</AlertDialogCancel>
              <AlertDialogAction
                disabled={busy}
                onClick={() => {
                  if (
                    confirmOwner === identity &&
                    useAssistantStore.getState().owner === identity
                  )
                    void useAssistantStore.getState().clearHistory()
                }}
              >
                {t('assistant.history.clearConfirm')}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </div>
      {historyError && (
        <div className="mt-2 flex flex-wrap items-center gap-2">
          <p role="alert" className="text-destructive">
            {t('assistant.history.operationFailed')}{' '}
            {t(`assistant.history.error.${historyError}`)}
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
            {t(`assistant.history.error.${saveError}`)}
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
          ) : (
            <Button
              size="sm"
              variant="outline"
              disabled={busy || saving}
              onClick={() => void useAssistantStore.getState().persistHistory()}
            >
              {t('assistant.history.retrySave')}
            </Button>
          )}
        </div>
      )}
    </div>
  )
}
