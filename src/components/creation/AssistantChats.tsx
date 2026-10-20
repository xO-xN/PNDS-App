import { useRef, useState } from 'react'
import { Check, ChevronDown, Plus, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
} from '@/components/ui/alert-dialog'
import { assistantConversations } from '@/lib/assistant-conversations'
import { useAssistantStore } from '@/store/assistant-store'
import { useAssistantProjectStore } from '@/store/assistant-project-store'

interface ChatDeletion {
  owner: string
  id: string | null
  title: string
}

export function AssistantChats() {
  const { t } = useTranslation()
  const messages = useAssistantStore(state => state.messages)
  const active = useAssistantStore(state => state.activeConversationId)
  const input = useAssistantStore(state => state.input)
  const owner = useAssistantStore(state => state.owner)
  const historyState = useAssistantStore(state => state.historyState)
  const busy = useAssistantStore(state => state.historyBusy)
  const historyError = useAssistantStore(state => state.historyError)
  const stale = useAssistantStore(
    state => state.historySaveError === 'staleHistory'
  )
  const phase = useAssistantStore(state => state.phase)
  const projectBusy = useAssistantProjectStore(
    state => state.planning || !!state.whole
  )
  const [open, setOpen] = useState(false)
  const [deletion, setDeletion] = useState<ChatDeletion | null>(null)
  const [failed, setFailed] = useState(false)
  const pendingDeletion = useRef<ChatDeletion | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const selectedChat = useRef<HTMLButtonElement>(null)
  const chats = assistantConversations(messages).map((chat, index) => ({
    ...chat,
    title: `${index + 1} · ${
      chat.messages
        .find(message => message.role === 'user')
        ?.text.replace(/\s+/g, ' ')
        .slice(0, 60) || t('assistant.chat.untitledChat')
    }`,
  }))
  const disabled = historyState !== 'ready' || busy || stale
  const deleteDisabled = disabled || phase !== 'idle' || projectBusy
  return (
    <div className="flex min-w-0 flex-1 items-center gap-1">
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            ref={trigger}
            type="button"
            size="sm"
            variant="ghost"
            className="min-w-0 flex-1 justify-between px-2 text-xs"
            disabled={disabled}
            aria-label={t('assistant.chat.chats')}
            title={
              phase !== 'idle' ? t('assistant.chat.chatSwitchHint') : undefined
            }
          >
            <span className="truncate">
              {chats.find(chat => chat.id === active)?.title}
            </span>
            <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="start"
          className="max-h-80 w-80 max-w-[calc(100vw-2rem)] overflow-y-auto p-1"
          aria-label={t('assistant.chat.chats')}
          onOpenAutoFocus={event => {
            event.preventDefault()
            selectedChat.current?.focus()
            selectedChat.current?.scrollIntoView({ block: 'nearest' })
          }}
          onCloseAutoFocus={event => {
            if (pendingDeletion.current) {
              event.preventDefault()
              setFailed(false)
              setDeletion(pendingDeletion.current)
              pendingDeletion.current = null
            }
          }}
        >
          <ul
            className="space-y-0.5"
            onKeyDown={event => {
              const directions = ['ArrowDown', 'ArrowUp', 'Home', 'End']
              if (!directions.includes(event.key)) return
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[data-chat-select]'
                )
              )
              const row = (event.target as HTMLElement).closest('li')
              const index = buttons.findIndex(
                button => button.closest('li') === row
              )
              const next =
                event.key === 'Home'
                  ? 0
                  : event.key === 'End'
                    ? buttons.length - 1
                    : (index +
                        (event.key === 'ArrowDown' ? 1 : -1) +
                        buttons.length) %
                      buttons.length
              event.preventDefault()
              buttons[next]?.focus()
              buttons[next]?.scrollIntoView({ block: 'nearest' })
            }}
          >
            {chats.map(chat => (
              <li
                key={chat.id ?? 'original'}
                className="group flex min-w-0 items-center gap-1 rounded-sm hover:bg-accent focus-within:bg-accent"
              >
                <Button
                  ref={chat.id === active ? selectedChat : undefined}
                  data-chat-select=""
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="min-w-0 flex-1 justify-start px-2 text-xs"
                  aria-pressed={chat.id === active}
                  disabled={disabled}
                  onClick={() => {
                    useAssistantStore.getState().switchConversation(chat.id)
                    setOpen(false)
                  }}
                >
                  <Check
                    className={`size-3 shrink-0 ${chat.id === active ? '' : 'invisible'}`}
                    aria-hidden="true"
                  />
                  <span className="truncate">{chat.title}</span>
                </Button>
                {!(messages.length === 0 && input === '') && (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="shrink-0 text-muted-foreground opacity-0 hover:text-destructive focus-visible:opacity-100 group-hover:opacity-100 group-focus-within:opacity-100 disabled:opacity-40"
                    aria-label={t('assistant.chat.deleteLabel', {
                      chat: chat.title,
                    })}
                    title={
                      deleteDisabled
                        ? t('assistant.chat.deleteBusy')
                        : t('assistant.chat.deleteLabel', { chat: chat.title })
                    }
                    disabled={deleteDisabled}
                    onClick={() => {
                      if (!owner) return
                      pendingDeletion.current = {
                        owner,
                        id: chat.id,
                        title: chat.title,
                      }
                      setOpen(false)
                    }}
                  >
                    <Trash2 className="size-3.5" aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      <Button
        size="icon-sm"
        type="button"
        variant="ghost"
        className="shrink-0"
        aria-label={t('assistant.chat.newChat')}
        title={t('assistant.chat.newChat')}
        disabled={disabled || phase !== 'idle'}
        onClick={() => useAssistantStore.getState().newTopic()}
      >
        <Plus aria-hidden="true" />
      </Button>
      <AlertDialog
        open={!!deletion && deletion.owner === owner}
        onOpenChange={value => {
          if (!value && !busy) setDeletion(null)
        }}
      >
        <AlertDialogContent
          onEscapeKeyDown={event => {
            if (busy) event.preventDefault()
          }}
          onCloseAutoFocus={event => {
            event.preventDefault()
            trigger.current?.focus()
          }}
        >
          <AlertDialogHeader>
            <AlertDialogTitle>
              {t('assistant.chat.deleteTitle', { chat: deletion?.title })}
            </AlertDialogTitle>
            <AlertDialogDescription>
              {t('assistant.chat.deleteDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          {failed && (
            <p role="alert" className="text-sm text-destructive">
              {t('assistant.chat.deleteFailed')}{' '}
              {historyError && t(`assistant.history.error.${historyError}`)}
            </p>
          )}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy}>
              {t('close.cancel')}
            </AlertDialogCancel>
            <AlertDialogAction
              disabled={deleteDisabled}
              onClick={async event => {
                event.preventDefault()
                if (
                  !deletion ||
                  useAssistantStore.getState().owner !== deletion.owner
                )
                  return
                setFailed(false)
                const deleted = await useAssistantStore
                  .getState()
                  .deleteConversation(deletion.id)
                if (useAssistantStore.getState().owner !== deletion.owner)
                  return
                if (deleted) setDeletion(null)
                else setFailed(true)
              }}
            >
              {t('assistant.chat.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
