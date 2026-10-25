import { useId, useRef, useState, type ReactNode } from 'react'
import { CircleStop, Ellipsis, Plus, Trash2 } from 'lucide-react'
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
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'

export function AssistantHistoryControls({
  identity,
  children,
}: {
  identity: string
  children?: ReactNode
}) {
  const { t } = useTranslation()
  const chatGroupId = useId()
  const discussionGroupId = useId()
  const clearGroupId = useId()
  const historyState = useAssistantStore(state => state.historyState)
  const owner = useAssistantStore(state => state.owner)
  const busy = useAssistantStore(state => state.historyBusy)
  const saving = useAssistantStore(state => state.historySaving)
  const phase = useAssistantStore(state => state.phase)
  const mode = useAssistantStore(state => state.mode)
  const activeQuestion = useAssistantStore(state => state.activeQuestion)
  const questionBusy = useAssistantStore(state => state.questionBusy)
  const historyError = useAssistantStore(state => state.historyError)
  const saveError = useAssistantStore(state => state.historySaveError)
  const projectName = useCreationStore(
    state => state.workspace?.project.name ?? ''
  )
  const [confirmOwner, setConfirmOwner] = useState<string | null>(null)
  const [reloadOwner, setReloadOwner] = useState<string | null>(null)
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
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              ref={moreButton}
              type="button"
              size="icon-sm"
              variant="ghost"
              className="shrink-0"
              aria-label={t('assistant.chat.more')}
            >
              <Ellipsis aria-hidden="true" />
            </Button>
          </DropdownMenuTrigger>

          <DropdownMenuContent
            align="end"
            className="pnds-action-menu creation-surface-popover"
            onCloseAutoFocus={event => {
              const action = menuAction.current
              menuAction.current = null
              if (action) {
                event.preventDefault()
                action()
              }
            }}
          >
            <DropdownMenuGroup aria-labelledby={chatGroupId}>
              <DropdownMenuLabel id={chatGroupId}>
                {t('assistant.chat.menu.chatGroup')}
              </DropdownMenuLabel>
              <DropdownMenuItem
                icon={<Plus aria-hidden="true" />}
                description={t('assistant.chat.menu.newDescription')}
                disabled={
                  owner !== identity ||
                  historyState !== 'ready' ||
                  busy ||
                  saveError === 'staleHistory' ||
                  phase !== 'idle'
                }
                onSelect={() => {
                  menuAction.current = () => {
                    const state = useAssistantStore.getState()
                    if (state.owner !== identity) return
                    if (
                      state.historyState === 'ready' &&
                      !state.historyBusy &&
                      state.historySaveError !== 'staleHistory' &&
                      state.phase === 'idle'
                    )
                      state.newTopic()
                    moreButton.current?.focus()
                  }
                }}
              >
                {t('assistant.chat.newChat')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
            {mode === 'discussion' &&
              activeQuestion &&
              !activeQuestion.question.materialConflict && (
                <>
                  <DropdownMenuSeparator />
                  <DropdownMenuGroup aria-labelledby={discussionGroupId}>
                    <DropdownMenuLabel id={discussionGroupId}>
                      {t('assistant.chat.menu.discussionGroup')}
                    </DropdownMenuLabel>
                    <DropdownMenuItem
                      icon={<CircleStop aria-hidden="true" />}
                      description={t('assistant.chat.menu.cancelDescription')}
                      disabled={phase !== 'idle' || questionBusy || busy}
                      onSelect={() => {
                        menuAction.current = () => {
                          const state = useAssistantStore.getState()
                          if (
                            state.owner === identity &&
                            state.mode === 'discussion' &&
                            state.phase === 'idle' &&
                            !state.questionBusy &&
                            state.activeQuestion?.taskId ===
                              activeQuestion.taskId &&
                            state.activeQuestion.question.id ===
                              activeQuestion.question.id &&
                            state.activeQuestion.conversationId ===
                              state.activeConversationId
                          )
                            state.stop()
                        }
                      }}
                    >
                      {t('assistant.question.cancelRound')}
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </>
              )}
            <DropdownMenuSeparator />
            <DropdownMenuGroup aria-labelledby={clearGroupId}>
              <DropdownMenuLabel id={clearGroupId}>
                {t('assistant.chat.menu.clearGroup')}
              </DropdownMenuLabel>
              <DropdownMenuItem
                icon={<Trash2 aria-hidden="true" />}
                description={t('assistant.chat.menu.clearDescription')}
                variant="destructive"
                disabled={historyState === 'loading' || busy}
                onSelect={() => {
                  menuAction.current = () => setConfirmOwner(identity)
                }}
              >
                {t('assistant.history.clear')}
              </DropdownMenuItem>
            </DropdownMenuGroup>
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
