import { useId, useLayoutEffect, useRef, useState } from 'react'
import {
  Check,
  History,
  MessageSquare,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { SearchField } from '@/components/ui/search-field'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogCancel,
  AlertDialogAction,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog'
import { assistantConversations } from '@/lib/assistant-conversations'
import { useAssistantStore } from '@/store/assistant-store'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import { useCreationStore } from '@/store/creation-store'
import './assistant-chat-history.css'

interface ChatTarget {
  owner: string
  id: string | null
  title: string
}

interface ChatRenaming extends ChatTarget {
  epoch: string
  surface: 'header' | 'history'
}

export function AssistantChats({
  identity,
  onFocusComposer,
}: {
  identity: string
  onFocusComposer?: () => void
}) {
  const { t } = useTranslation()
  const messages = useAssistantStore(state => state.messages)
  const active = useAssistantStore(state => state.activeConversationId)
  const input = useAssistantStore(state => state.input)
  const drafts = useAssistantStore(state => state.conversationDrafts)
  const conversationTitles = useAssistantStore(
    state => state.conversationTitles
  )
  const owner = useAssistantStore(state => state.owner)
  const historyState = useAssistantStore(state => state.historyState)
  const busy = useAssistantStore(state => state.historyBusy)
  const historyError = useAssistantStore(state => state.historyError)
  const saveError = useAssistantStore(state => state.historySaveError)
  const historyEpoch = useAssistantStore(state => state.historyEpoch)
  const phase = useAssistantStore(state => state.phase)
  const projectBusy = useAssistantProjectStore(
    state => state.planning || !!state.whole
  )
  const projectName = useCreationStore(
    state => state.workspace?.project.name ?? ''
  )
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [searchExpanded, setSearchExpanded] = useState(false)
  const [deletion, setDeletion] = useState<ChatTarget | null>(null)
  const [resetOwner, setResetOwner] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [renaming, setRenaming] = useState<ChatRenaming | null>(null)
  const [renamingBusy, setRenamingBusy] = useState(false)
  const [renameFailed, setRenameFailed] = useState(false)
  const listId = useId()
  const searchId = useId()
  const heading = useRef<HTMLHeadingElement>(null)
  const searchTrigger = useRef<HTMLButtonElement>(null)
  const search = useRef<HTMLInputElement>(null)
  const list = useRef<HTMLUListElement>(null)
  const deleteTrigger = useRef<HTMLButtonElement>(null)
  const headerRename = useRef<HTMLButtonElement>(null)
  const renameInput = useRef<HTMLInputElement>(null)
  const renameOrigin = useRef<ChatRenaming | null>(null)
  const renameAction = useRef(false)
  const renameRestoreFocus = useRef(false)
  const focusComposerOnClose = useRef(false)
  useLayoutEffect(() => {
    if (searchExpanded) search.current?.focus({ preventScroll: true })
  }, [searchExpanded])
  const chats = assistantConversations(messages)
    .reverse()
    .map((chat, index) => {
      const question = chat.messages
        .find(message => message.role === 'user')
        ?.text.replace(/\s+/g, ' ')
        .trim()
      const key = chat.id ?? 'original'
      const customTitle = Object.hasOwn(conversationTitles, key)
        ? conversationTitles[key]
        : undefined
      return {
        id: chat.id,
        draftId: `${listId}-draft-${index}`,
        title:
          customTitle ||
          question?.match(/^.{0,60}/u)?.[0] ||
          t('assistant.chat.untitledChat'),
        searchTitle:
          customTitle || question || t('assistant.chat.untitledChat'),
        hasDraft: Boolean(
          (chat.id === active
            ? input
            : drafts[chat.id ?? 'original']?.input
          )?.trim()
        ),
      }
    })
  const activeTitle = chats.find(chat => chat.id === active)
  const normalizedQuery = query.trim().replace(/\s+/g, ' ').toLocaleLowerCase()
  const loadFailed = historyState === 'error'
  const results = loadFailed
    ? []
    : chats.filter(chat =>
        chat.searchTitle.toLocaleLowerCase().includes(normalizedQuery)
      )
  const historyDisabled =
    owner !== identity ||
    historyState !== 'ready' ||
    busy ||
    saveError === 'staleHistory'
  const openDisabled = owner !== identity || (historyDisabled && !loadFailed)
  const newDisabled = historyDisabled || !!saveError || phase !== 'idle'
  const deleteDisabled = historyDisabled || phase !== 'idle' || projectBusy
  const renameDisabled = deleteDisabled || renamingBusy || !historyEpoch
  const renameOpen =
    !!renaming &&
    renaming.owner === owner &&
    owner === identity &&
    renaming.epoch === historyEpoch &&
    (renaming.surface !== 'header' || renaming.id === active)
  const renameName = renaming?.title.trim() ?? ''
  const renameInvalid =
    !renameName ||
    renameName.length > 120 ||
    /[\p{Cc}\u2028\u2029]/u.test(renameName)
  const emptyHistory =
    messages.length === 0 &&
    input === '' &&
    !Object.hasOwn(conversationTitles, 'original')
  const focusSearch = () => {
    const target = loadFailed
      ? heading.current
      : searchExpanded
        ? search.current
        : searchTrigger.current
    target?.focus({ preventScroll: true })
  }
  const focusRow = (row: HTMLButtonElement | undefined) => {
    row?.focus({ preventScroll: true })
    row?.scrollIntoView({ block: 'nearest' })
  }
  useLayoutEffect(() => {
    if (renameOpen) {
      renameInput.current?.focus({ preventScroll: true })
      renameInput.current?.select()
    }
  }, [renameOpen, renaming?.id, renaming?.surface])
  useLayoutEffect(() => {
    if (renamingBusy || !renameRestoreFocus.current) return
    if (renameOpen) {
      if (renameFailed) {
        renameRestoreFocus.current = false
        renameInput.current?.focus({ preventScroll: true })
      }
      return
    }
    renameRestoreFocus.current = false
    const origin = renameOrigin.current
    const target =
      origin?.surface === 'header'
        ? headerRename.current
        : Array.from(
            list.current?.querySelectorAll<HTMLButtonElement>(
              '[data-chat-rename]'
            ) ?? []
          ).find(
            button => button.dataset.chatRename === (origin?.id ?? 'original')
          )
    if (target && !target.disabled) target.focus({ preventScroll: true })
    else if (open) {
      const fallback = loadFailed
        ? heading.current
        : searchExpanded
          ? search.current
          : searchTrigger.current
      fallback?.focus({ preventScroll: true })
    }
  }, [renameOpen, renamingBusy, renameFailed, open, loadFailed, searchExpanded])
  const cancelRename = (restoreFocus: boolean) => {
    if (renamingBusy) return
    renameAction.current = true
    renameRestoreFocus.current = restoreFocus
    setRenaming(null)
    setRenameFailed(false)
  }
  const newChat = () => {
    const state = useAssistantStore.getState()
    if (
      state.owner !== identity ||
      state.historyState !== 'ready' ||
      state.historyBusy ||
      state.historySaveError ||
      state.phase !== 'idle'
    )
      return
    state.newTopic()
    if (
      useAssistantStore.getState().activeConversationId ===
      state.activeConversationId
    )
      return
    if (open) {
      focusComposerOnClose.current = true
      setOpen(false)
    } else onFocusComposer?.()
  }
  const choose = (id: string | null) => {
    const state = useAssistantStore.getState()
    if (
      state.owner !== identity ||
      state.historyState !== 'ready' ||
      state.historyBusy ||
      state.historySaveError === 'staleHistory'
    )
      return
    if (renameOpen) cancelRename(false)
    state.switchConversation(id)
    focusComposerOnClose.current = true
    setOpen(false)
  }
  const beginRename = (
    chat: { id: string | null; title: string },
    surface: ChatRenaming['surface']
  ) => {
    const state = useAssistantStore.getState()
    if (state.owner !== identity || !state.historyEpoch || renameDisabled)
      return
    renameAction.current = false
    renameRestoreFocus.current = false
    setRenameFailed(false)
    const target = {
      owner: identity,
      epoch: state.historyEpoch,
      id: chat.id,
      title: chat.title,
      surface,
    }
    renameOrigin.current = target
    setRenaming(target)
  }
  const saveRename = async (restoreFocus: boolean) => {
    if (
      !renameOpen ||
      !renaming ||
      renamingBusy ||
      renameAction.current ||
      renameInvalid
    )
      return
    const target = renaming
    renameAction.current = true
    renameRestoreFocus.current = restoreFocus
    setRenamingBusy(true)
    setRenameFailed(false)
    try {
      const saved = await useAssistantStore
        .getState()
        .renameConversation(target.id, renameName)
      const state = useAssistantStore.getState()
      if (state.owner !== target.owner || state.historyEpoch !== target.epoch)
        return
      if (saved) setRenaming(current => (current === target ? null : current))
      else setRenameFailed(true)
    } finally {
      renameAction.current = false
      setRenamingBusy(false)
    }
  }
  const nameEditor = (
    <form
      className="assistant-chat-name-editor"
      aria-busy={renamingBusy}
      onSubmit={event => {
        event.preventDefault()
        void saveRename(true)
      }}
      onBlur={event => {
        if (!event.currentTarget.contains(event.relatedTarget))
          void saveRename(false)
      }}
    >
      {renaming?.surface === 'history' && <MessageSquare aria-hidden="true" />}
      <input
        ref={renameInput}
        type="text"
        className="assistant-chat-name-input"
        aria-label={t('assistant.chat.name')}
        value={renaming?.title ?? ''}
        maxLength={120}
        disabled={renamingBusy}
        aria-invalid={renameInvalid || renameFailed}
        onChange={event => {
          setRenaming(current =>
            current ? { ...current, title: event.target.value } : null
          )
          setRenameFailed(false)
        }}
        onKeyDown={event => {
          if (event.nativeEvent.isComposing || event.keyCode === 229) {
            if (event.key === 'Enter') event.preventDefault()
            return
          }
          if (event.key === 'Enter') {
            event.preventDefault()
            void saveRename(true)
          } else if (event.key === 'Escape') {
            event.preventDefault()
            event.stopPropagation()
            cancelRename(true)
          }
        }}
      />
      {renameFailed && (
        <p role="alert" className="assistant-chat-name-error">
          {t('assistant.chat.renameFailed')}
        </p>
      )}
    </form>
  )

  return (
    <div className="assistant-chat-header">
      <div className="assistant-chat-current-name">
        {renameOpen && renaming.surface === 'header' ? (
          nameEditor
        ) : (
          <>
            <bdi
              className="assistant-chat-title"
              title={activeTitle?.searchTitle}
            >
              {activeTitle?.title}
            </bdi>
            {activeTitle && (
              <Button
                ref={headerRename}
                type="button"
                size="icon-sm"
                variant="ghost"
                className="assistant-chat-rename-trigger"
                aria-label={t('assistant.chat.renameLabel', {
                  chat: activeTitle.title,
                })}
                disabled={renameDisabled || renameOpen}
                onClick={() => beginRename(activeTitle, 'header')}
              >
                <Pencil className="size-3" aria-hidden="true" />
              </Button>
            )}
          </>
        )}
      </div>
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={newDisabled}
        onClick={newChat}
      >
        <Plus aria-hidden="true" />
        {t('assistant.chat.newChat')}
      </Button>
      <Dialog
        open={open && owner === identity}
        onOpenChange={next => {
          if (
            deletion ||
            (next && renameOpen) ||
            renamingBusy ||
            resetOwner === identity ||
            (next && openDisabled)
          )
            return
          if (!next && renameOpen && renaming.surface === 'history')
            cancelRename(false)
          if (next) {
            setQuery('')
            setSearchExpanded(false)
          }
          setOpen(next)
        }}
      >
        <DialogTrigger asChild>
          <Button
            type="button"
            size="sm"
            variant="outline"
            disabled={openDisabled}
          >
            <History aria-hidden="true" />
            {t('assistant.chat.chats')}
          </Button>
        </DialogTrigger>
        <DialogContent
          className="assistant-chat-history-dialog creation-surface-popover"
          showCloseButton={false}
          onEscapeKeyDown={event => {
            if (
              event.isComposing ||
              event.keyCode === 229 ||
              deletion ||
              resetOwner === identity
            ) {
              event.preventDefault()
              return
            }
            if (renameOpen) {
              event.preventDefault()
              cancelRename(true)
            }
          }}
          onOpenAutoFocus={event => {
            event.preventDefault()
            focusSearch()
          }}
          onCloseAutoFocus={event => {
            if (focusComposerOnClose.current) {
              focusComposerOnClose.current = false
              if (onFocusComposer) {
                event.preventDefault()
                onFocusComposer()
              }
            }
          }}
        >
          <header className="assistant-chat-history-heading">
            <DialogTitle ref={heading} tabIndex={-1}>
              {t('assistant.chat.chats')}
            </DialogTitle>
            {!loadFailed && (
              <div
                className="assistant-chat-history-search"
                data-expanded={searchExpanded}
                onPointerEnter={event => {
                  if (event.pointerType === 'mouse' && !renameOpen)
                    setSearchExpanded(true)
                }}
                onBlur={event => {
                  if (
                    event.nativeEvent.target !== searchTrigger.current &&
                    !query.trim() &&
                    !event.currentTarget.contains(event.relatedTarget)
                  ) {
                    setSearchExpanded(false)
                    setQuery('')
                  }
                }}
              >
                <SearchField
                  ref={search}
                  id={searchId}
                  size="sm"
                  aria-label={t('assistant.chat.historySearch')}
                  placeholder={t('assistant.chat.historySearch')}
                  aria-controls={listId}
                  aria-hidden={!searchExpanded || undefined}
                  inert={!searchExpanded}
                  tabIndex={searchExpanded ? 0 : -1}
                  value={query}
                  disabled={renameOpen}
                  onValueChange={setQuery}
                  onKeyDown={event => {
                    if (
                      event.nativeEvent.isComposing ||
                      event.keyCode === 229 ||
                      historyDisabled
                    )
                      return
                    const first =
                      list.current?.querySelector<HTMLButtonElement>(
                        '[data-chat-select]'
                      )
                    if (!first) return
                    if (event.key === 'ArrowDown') {
                      event.preventDefault()
                      focusRow(first)
                    } else if (event.key === 'Enter') {
                      event.preventDefault()
                      first.click()
                    }
                  }}
                />
                <button
                  ref={searchTrigger}
                  type="button"
                  className="assistant-chat-history-search-trigger pnds-focus-ring"
                  aria-label={t('assistant.chat.historySearch')}
                  aria-expanded={searchExpanded}
                  aria-controls={searchId}
                  hidden={searchExpanded}
                  disabled={renameOpen}
                  onClick={() => setSearchExpanded(true)}
                />
              </div>
            )}
          </header>
          <DialogDescription
            className={
              phase === 'idle' && !loadFailed
                ? 'sr-only'
                : 'assistant-chat-history-description'
            }
          >
            {loadFailed
              ? historyError
                ? t(
                    historyError === 'tooLarge'
                      ? 'assistant.history.loadTooLarge'
                      : `assistant.history.error.${historyError}`
                  )
                : t('assistant.history.saving')
              : phase === 'idle'
                ? t('assistant.chat.historyDescription')
                : t('assistant.chat.chatSwitchHint')}
          </DialogDescription>
          <ul
            ref={list}
            id={listId}
            className="assistant-chat-history-list"
            onKeyDown={event => {
              if (
                !['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key) ||
                renameOpen ||
                historyDisabled
              )
                return
              const buttons = Array.from(
                event.currentTarget.querySelectorAll<HTMLButtonElement>(
                  '[data-chat-select]'
                )
              )
              const row = (event.target as HTMLElement).closest('li')
              const index = buttons.findIndex(
                button => button.closest('li') === row
              )
              if (index < 0) return
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
              focusRow(buttons[next])
            }}
          >
            {results.map(chat => (
              <li
                key={chat.id ?? 'original'}
                className="assistant-chat-history-row"
                data-active={chat.id === active || undefined}
              >
                {renameOpen &&
                renaming.surface === 'history' &&
                renaming.id === chat.id ? (
                  nameEditor
                ) : (
                  <>
                    <button
                      data-chat-select=""
                      type="button"
                      className="assistant-chat-history-choice pnds-focus-ring"
                      title={chat.searchTitle}
                      aria-label={chat.title}
                      aria-describedby={
                        chat.hasDraft ? chat.draftId : undefined
                      }
                      aria-pressed={chat.id === active}
                      disabled={historyDisabled}
                      onClick={() => choose(chat.id)}
                    >
                      <MessageSquare aria-hidden="true" />
                      <span>
                        <bdi>{chat.title}</bdi>
                        {chat.hasDraft && (
                          <small id={chat.draftId}>
                            {t('assistant.chat.historyDraft')}
                          </small>
                        )}
                      </span>
                      {chat.id === active && <Check aria-hidden="true" />}
                    </button>
                    <Button
                      type="button"
                      size="icon-sm"
                      variant="ghost"
                      className="assistant-chat-history-rename"
                      data-chat-rename={chat.id ?? 'original'}
                      aria-label={t('assistant.chat.renameLabel', {
                        chat: chat.title,
                      })}
                      disabled={renameDisabled || renameOpen}
                      onClick={() => beginRename(chat, 'history')}
                    >
                      <Pencil className="size-3" aria-hidden="true" />
                    </Button>
                  </>
                )}
                {!emptyHistory && (
                  <Button
                    type="button"
                    size="icon-sm"
                    variant="ghost"
                    className="assistant-chat-history-delete"
                    aria-label={t('assistant.chat.deleteLabel', {
                      chat: chat.title,
                    })}
                    disabled={deleteDisabled || renameOpen}
                    onClick={event => {
                      if (!owner) return
                      deleteTrigger.current = event.currentTarget
                      setFailed(false)
                      setDeletion({ owner, id: chat.id, title: chat.title })
                    }}
                  >
                    <Trash2 aria-hidden="true" />
                  </Button>
                )}
              </li>
            ))}
            {results.length === 0 && !loadFailed && (
              <li className="assistant-chat-history-empty" role="status">
                {t('assistant.chat.historyNoResults')}
              </li>
            )}
          </ul>
          <footer className="assistant-chat-history-footer">
            {loadFailed ? (
              <AlertDialog
                open={resetOwner === identity && owner === identity}
                onOpenChange={next => setResetOwner(next ? identity : null)}
              >
                <AlertDialogTrigger asChild>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={busy}
                  >
                    {t('assistant.history.clear')}
                  </Button>
                </AlertDialogTrigger>
                <AlertDialogContent
                  className="assistant-chat-delete-dialog creation-surface-popover"
                  onCloseAutoFocus={event => {
                    const state = useAssistantStore.getState()
                    if (state.historyBusy || state.historyState !== 'error') {
                      event.preventDefault()
                      focusSearch()
                    }
                  }}
                >
                  <AlertDialogHeader>
                    <AlertDialogTitle>
                      {t('assistant.history.clearTitle', {
                        project: projectName,
                      })}
                    </AlertDialogTitle>
                    <AlertDialogDescription>
                      {t('assistant.history.clearDescription')}
                    </AlertDialogDescription>
                  </AlertDialogHeader>
                  <AlertDialogFooter>
                    <AlertDialogCancel>{t('close.cancel')}</AlertDialogCancel>
                    <AlertDialogAction
                      className="bg-destructive text-destructive-foreground hover:bg-destructive-hover"
                      disabled={busy}
                      onClick={() => {
                        const state = useAssistantStore.getState()
                        if (
                          resetOwner === identity &&
                          state.owner === identity &&
                          state.historyState === 'error' &&
                          !state.historyBusy
                        )
                          void state.clearHistory()
                      }}
                    >
                      {t('assistant.history.clearConfirm')}
                    </AlertDialogAction>
                  </AlertDialogFooter>
                </AlertDialogContent>
              </AlertDialog>
            ) : (
              <span>
                {t('assistant.chat.historyCount', { count: results.length })}
              </span>
            )}
          </footer>
        </DialogContent>
      </Dialog>
      <AlertDialog
        open={!!deletion && deletion.owner === owner && owner === identity}
        onOpenChange={value => {
          if (!value && !busy) setDeletion(null)
        }}
      >
        <AlertDialogContent
          className="assistant-chat-delete-dialog creation-surface-popover"
          onEscapeKeyDown={event => {
            if (busy) event.preventDefault()
          }}
          onCloseAutoFocus={event => {
            event.preventDefault()
            const target = deleteTrigger.current
            deleteTrigger.current = null
            if (target?.isConnected && !target.disabled)
              target.focus({ preventScroll: true })
            else focusSearch()
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
              className="bg-destructive text-destructive-foreground hover:bg-destructive-hover"
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
                if (deleted) {
                  deleteTrigger.current = null
                  setDeletion(null)
                } else setFailed(true)
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
