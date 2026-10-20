import { useRef, useState, type ReactNode } from 'react'
import { Check, Ellipsis, LoaderCircle } from 'lucide-react'
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
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Dialog, DialogContent, DialogTitle } from '@/components/ui/dialog'
import { AssistantProjectOverview } from './AssistantProjectOverview'
import { AssistantTasks } from './AssistantTasks'

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
  const [confirmOwner, setConfirmOwner] = useState<string | null>(null)
  const [reloadOwner, setReloadOwner] = useState<string | null>(null)
  const [panel, setPanel] = useState<'overview' | 'tasks' | null>(null)
  const menuAction = useRef<(() => void) | null>(null)
  const moreButton = useRef<HTMLButtonElement>(null)
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
    <div className="shrink-0 border-b border-(--pnds-border) px-3 py-2 text-xs">
      <div className="flex min-w-0 items-center gap-1">
        {children}
        {status && (
          <span
            role="status"
            aria-live="polite"
            aria-atomic="true"
            aria-label={status}
            title={status}
            className="inline-flex size-6 shrink-0 items-center justify-center text-muted-foreground"
          >
            {updating || historyState === 'loading' ? (
              <LoaderCircle
                className="size-3 animate-spin motion-reduce:animate-none"
                aria-hidden="true"
              />
            ) : (
              <Check className="size-3" aria-hidden="true" />
            )}
            <span className="sr-only">{status}</span>
          </span>
        )}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={moreButton}
              type="button"
              size="icon-sm"
              variant="ghost"
              className="shrink-0"
              aria-label={t('assistant.chat.more')}
              title={t('assistant.chat.more')}
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent
            align="end"
            onCloseAutoFocus={event => {
              const action = menuAction.current
              menuAction.current = null
              if (action) {
                event.preventDefault()
                action()
              }
            }}
          >
            <DropdownMenuItem
              onSelect={() => {
                menuAction.current = () => setPanel('overview')
              }}
            >
              {t('assistant.overview.title')}
            </DropdownMenuItem>
            <DropdownMenuItem
              onSelect={() => {
                menuAction.current = () => setPanel('tasks')
              }}
            >
              {t('assistant.tasks.title')}
            </DropdownMenuItem>
            <DropdownMenuItem
              variant="destructive"
              disabled={historyState === 'loading' || busy}
              onSelect={() => {
                menuAction.current = () => setConfirmOwner(identity)
              }}
            >
              {t('assistant.history.clear')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
        <AlertDialog
          open={confirmOwner === identity}
          onOpenChange={open => setConfirmOwner(open ? identity : null)}
        >
          <AlertDialogContent
            onCloseAutoFocus={event => {
              event.preventDefault()
              moreButton.current?.focus()
            }}
          >
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
      <AssistantProjectOverview
        identity={identity}
        open={panel === 'overview'}
        onOpenChange={open => setPanel(open ? 'overview' : null)}
        onClose={() => moreButton.current?.focus()}
      />
      <Dialog
        open={panel === 'tasks'}
        onOpenChange={open => setPanel(open ? 'tasks' : null)}
      >
        <DialogContent
          className="max-h-[80vh] overflow-auto"
          onCloseAutoFocus={event => {
            event.preventDefault()
            moreButton.current?.focus()
          }}
        >
          <DialogTitle>{t('assistant.tasks.title')}</DialogTitle>
          <AssistantTasks identity={identity} />
        </DialogContent>
      </Dialog>
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
