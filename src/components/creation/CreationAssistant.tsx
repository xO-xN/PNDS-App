import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import ReactMarkdown from 'react-markdown'
import remarkGfm from 'remark-gfm'
import { Pencil } from 'lucide-react'
import { conversationMessages } from '@/lib/assistant-conversations'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useSettingsStore } from '@/store/settings-store'
import { openHelpWindow } from '@/lib/help-window'
import { Button } from '@/components/ui/button'
import type { AssistantMessage } from '@/lib/assistant-types'
import { AssistantHistorySnapshots } from './AssistantHistorySnapshots'
import { AssistantHistoryControls } from './AssistantHistoryControls'
import { AssistantChats } from './AssistantChats'
import { AssistantHandoffCard } from './AssistantHandoffCard'
import { AssistantLiveProposals } from './AssistantLiveProposals'
import { useAssistantProposalStore } from '@/store/assistant-proposal-store'
import { AssistantProjectControls } from './AssistantProjectControls'
import { AssistantAttachments } from './AssistantAttachments'
import { AssistantProjectOverview } from './AssistantProjectOverview'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import { assistantSourceKey } from '@/lib/assistant-project'
import { commands } from '@/lib/tauri-bindings'
import { useCreationFilesStore } from '@/store/creation-files-store'
import {
  AssistantContextUsage,
  AssistantUsageStatistics,
} from './AssistantContextUsage'
import {
  AssistantContextControls,
  AssistantSummaryView,
} from './AssistantContextControls'

const BOTTOM_THRESHOLD = 48

/** Discussion owns no file access or execution. Its only request entry is the assistant store. */
export function CreationAssistant({
  identity,
  renderMessageCards,
  onCheck,
}: {
  identity: string
  renderMessageCards?: (message: AssistantMessage) => ReactNode
  onCheck?: () => void
}) {
  const { t } = useTranslation()
  const [sourceNote, setSourceNote] = useState<{
    owner: string
    key: string
    kind: 'changed' | 'unavailable'
  } | null>(null)
  const input = useAssistantStore(state => state.input)
  const liveProposals = useAssistantProposalStore(state => state.items)
  const allMessages = useAssistantStore(state => state.messages)
  const activeConversationId = useAssistantStore(
    state => state.activeConversationId
  )
  const editing = useAssistantStore(state => state.editing)
  const messages = conversationMessages(allMessages, activeConversationId)
  const navigationIdentity = `${identity}:${activeConversationId ?? 'original'}`
  const phase = useAssistantStore(state => state.phase)
  const error = useAssistantStore(state => state.error)
  const planning = useAssistantProjectStore(state => state.planning)
  const whole = useAssistantProjectStore(state => state.whole)
  const configured = useAssistantStore(state => state.configured)
  const historyState = useAssistantStore(state => state.historyState)
  const historyBusy = useAssistantStore(state => state.historyBusy)
  const historySaveError = useAssistantStore(state => state.historySaveError)
  const historicalMessageIds = useAssistantStore(
    state => state.historicalMessageIds
  )
  const historyAppVersion = useAssistantStore(state => state.historyAppVersion)
  const view = useCreationReadingStore(state => state.view)
  const returnMessageId = useCreationReadingStore(
    state => state.returnMessageId
  )
  const transcript = useRef<HTMLDivElement>(null)
  const composer = useRef<HTMLTextAreaElement>(null)
  const transcriptContent = useRef<HTMLDivElement>(null)
  const followingLatest = useRef(true)
  const previousNavigation = useRef<{
    identity: string
    view: string
    target: string | null
    userMessage: string | null
  } | null>(null)
  const userMessage =
    messages.filter(message => message.role === 'user').at(-1)?.id ?? null
  const [pausedReading, setPausedReading] = useState<{
    identity: string
    userMessage: string | null
  } | null>(null)
  const showLatest =
    pausedReading?.identity === navigationIdentity &&
    pausedReading.userMessage === userMessage
  const canSend =
    phase === 'idle' &&
    !planning &&
    !whole &&
    configured &&
    input.trim() &&
    historyState === 'ready' &&
    !historyBusy &&
    historySaveError !== 'staleHistory'
  useEffect(() => {
    useAssistantStore.getState().syncWorkspace(identity)
  }, [identity])
  useLayoutEffect(() => {
    const previous = previousNavigation.current
    const newSend =
      userMessage !== null &&
      userMessage !== previous?.userMessage &&
      !historicalMessageIds.includes(userMessage)
    const ownerChanged = previous?.identity !== navigationIdentity
    const targetedNavigation =
      returnMessageId &&
      (ownerChanged ||
        previous?.view !== view ||
        previous.target !== returnMessageId)
    previousNavigation.current = {
      identity: navigationIdentity,
      view,
      target: returnMessageId,
      userMessage,
    }
    if (ownerChanged || messages.length === 0) {
      followingLatest.current = true
    }
    const panel = transcript.current
    if (view !== 'discussion' || !panel) return
    if (targetedNavigation && !newSend) {
      const target = Array.from(
        panel.querySelectorAll<HTMLElement>('[data-message-id]')
      ).find(element => element.dataset.messageId === returnMessageId)
      if (target) {
        followingLatest.current = false
        target.scrollIntoView({ block: 'nearest' })
        target.focus({ preventScroll: true })
        return
      }
    }
    if (newSend) followingLatest.current = true
    if (followingLatest.current) {
      panel.scrollTop = panel.scrollHeight
    }
  }, [
    messages,
    navigationIdentity,
    view,
    returnMessageId,
    historicalMessageIds,
    userMessage,
  ])
  useLayoutEffect(() => {
    const panel = transcript.current
    const content = transcriptContent.current
    if (
      view !== 'discussion' ||
      !panel ||
      !content ||
      typeof ResizeObserver === 'undefined'
    )
      return
    let disposed = false
    const observer = new ResizeObserver(() => {
      if (disposed) return
      if (followingLatest.current) panel.scrollTop = panel.scrollHeight
      setPausedReading(
        followingLatest.current
          ? null
          : { identity: navigationIdentity, userMessage }
      )
    })
    observer.observe(panel)
    observer.observe(content)
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [navigationIdentity, view, userMessage])

  return (
    <section
      aria-label={t('assistant.title')}
      className="creation-assistant flex min-h-0 flex-1 flex-col"
    >
      <AssistantChats />
      <AssistantHistoryControls identity={identity} />
      <AssistantProjectOverview identity={identity} />
      <div
        ref={transcript}
        className="pnds-focus-ring min-h-0 flex-1 overflow-auto p-4 [overflow-wrap:anywhere]"
        role="region"
        tabIndex={0}
        aria-label={t('assistant.messages')}
        onScroll={event => {
          if (view !== 'discussion') return
          const panel = event.currentTarget
          followingLatest.current =
            panel.scrollHeight - panel.clientHeight - panel.scrollTop <=
            BOTTOM_THRESHOLD
          setPausedReading(
            followingLatest.current
              ? null
              : { identity: navigationIdentity, userMessage }
          )
        }}
      >
        <div ref={transcriptContent} className="flow-root">
          {messages.length === 0 && (
            <p className="text-muted-foreground text-sm">
              {t('assistant.welcome')}
            </p>
          )}
          {messages.map(message => (
            <article
              key={message.id}
              data-message-id={message.id}
              tabIndex={-1}
              className={`pnds-focus-ring group mb-6 min-w-0 ${message.role === 'user' ? 'assistant-message-user ms-auto w-fit max-w-[88%] rounded-2xl px-4 py-3' : 'w-full py-1'}`}
            >
              <p
                className={
                  message.role === 'user'
                    ? 'sr-only'
                    : 'text-muted-foreground mb-2 text-xs'
                }
              >
                {t(
                  message.role === 'user' ? 'assistant.user' : 'assistant.title'
                )}
              </p>
              <div className="assistant-markdown min-w-0 text-sm">
                <ReactMarkdown
                  remarkPlugins={[remarkGfm]}
                  components={{
                    img: ({ alt }) => <span>{alt}</span>,
                    // Model-authored destinations are displayed as text. Verified
                    // corpus sources below are the only navigation actions.
                    a: ({ children }) => <span>{children}</span>,
                  }}
                >
                  {message.text}
                </ReactMarkdown>
              </div>
              {message.role === 'user' &&
                message.scope === 'platform' &&
                !message.attachments?.length &&
                !message.proposals?.length && (
                  <div className="mt-2 flex justify-end">
                    <button
                      type="button"
                      className="pnds-focus-ring inline-flex size-7 items-center justify-center rounded-md opacity-60 hover:opacity-100 focus-visible:opacity-100 disabled:opacity-25"
                      aria-label={t('assistant.chat.editQuestion')}
                      title={t('assistant.chat.editQuestion')}
                      disabled={
                        phase !== 'idle' ||
                        historyState !== 'ready' ||
                        historyBusy ||
                        historySaveError === 'staleHistory'
                      }
                      onClick={() => {
                        useAssistantStore.getState().beginEditing(message.id)
                        composer.current?.focus()
                      }}
                    >
                      <Pencil className="size-3.5" aria-hidden="true" />
                    </button>
                  </div>
                )}
              {message.role === 'assistant' &&
                message.status === 'pending' &&
                !message.text && (
                  <p className="text-muted-foreground text-sm">
                    {t(
                      phase === 'reading'
                        ? 'assistant.reading'
                        : 'assistant.waiting'
                    )}
                  </p>
                )}
              {message.status === 'cancelled' && (
                <p className="text-muted-foreground mt-2 text-xs">
                  {t('assistant.error.cancelled')}
                </p>
              )}
              {message.status === 'failed' && message.error && (
                <p className="mt-2 text-xs text-destructive">
                  {t(`assistant.error.${message.error}`)}
                </p>
              )}
              {message.role === 'assistant' &&
                message.status === 'completed' &&
                message.sources.length === 0 && (
                  <p className="text-muted-foreground mt-2 text-xs">
                    {t('assistant.noSources')}
                  </p>
                )}
              {historicalMessageIds.includes(message.id) && (
                <div className="text-muted-foreground mt-2 text-xs">
                  <p>
                    {t('assistant.history.appVersion', {
                      version: message.appVersion ?? historyAppVersion,
                    })}
                  </p>
                  <p>{t('assistant.history.restoredNote')}</p>
                </div>
              )}
              <AssistantHistorySnapshots
                message={message}
                showProposals={
                  !message.proposals?.some(
                    proposal => !!liveProposals[proposal.id]
                  )
                }
              />
              {!historicalMessageIds.includes(message.id) && (
                <>
                  <AssistantLiveProposals messageId={message.id} />
                  <AssistantHandoffCard messageId={message.id} />
                </>
              )}
              {message.contextMarker?.type === 'summary' && (
                <AssistantSummaryView
                  sections={message.contextMarker.sections}
                />
              )}
              {message.usage && (
                <AssistantUsageStatistics
                  usage={message.usage}
                  historical={historicalMessageIds.includes(message.id)}
                />
              )}
              {!historicalMessageIds.includes(message.id) &&
                renderMessageCards?.(message)}
              {message.sources.length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="pnds-focus-ring text-muted-foreground rounded-sm py-1">
                    {t(
                      message.sources.some(source => source.project)
                        ? 'assistant.project.sourceCount'
                        : 'assistant.sourceCount',
                      {
                        count: message.sources.length,
                      }
                    )}
                  </summary>
                  {(message.status === 'failed' ||
                    message.status === 'cancelled') && (
                    <p className="text-muted-foreground my-2">
                      {t('assistant.sourcesIncomplete')}
                    </p>
                  )}
                  <nav
                    aria-label={t('assistant.sources')}
                    className="flex flex-col items-start gap-1"
                  >
                    {message.sources.map(source => (
                      <div key={assistantSourceKey(source)} className="w-full">
                        <Button
                          key={`${source.locale}:${source.version ?? ''}:${source.docId}:${source.sectionId}:${source.format ?? ''}:${source.offset ?? ''}:${source.endOffset ?? ''}`}
                          size="sm"
                          variant="link"
                          className="h-auto max-w-full whitespace-normal px-0 text-start"
                          onClick={() => {
                            if (source.project) {
                              const page = source.project
                              void commands
                                .assistantProjectRead(identity, {
                                  path: page.path,
                                  version: null,
                                  offset: 0,
                                  pageLength: 64,
                                })
                                .then(result => {
                                  if (
                                    useAssistantStore.getState().owner !==
                                    identity
                                  )
                                    return
                                  if (result.status === 'error')
                                    setSourceNote({
                                      owner: identity,
                                      key: assistantSourceKey(source),
                                      kind: 'unavailable',
                                    })
                                  else {
                                    setSourceNote(
                                      result.data.version !== page.version
                                        ? {
                                            owner: identity,
                                            key: assistantSourceKey(source),
                                            kind: 'changed',
                                          }
                                        : null
                                    )
                                    useCreationFilesStore
                                      .getState()
                                      .locate(
                                        identity,
                                        page.path,
                                        page.startLine
                                      )
                                  }
                                })
                                .catch(() => {
                                  if (
                                    useAssistantStore.getState().owner ===
                                    identity
                                  )
                                    setSourceNote({
                                      owner: identity,
                                      key: assistantSourceKey(source),
                                      kind: 'unavailable',
                                    })
                                })
                            } else
                              void openHelpWindow({
                                kind: 'doc',
                                docId: source.docId,
                                anchor: source.sectionId,
                                locale: source.locale,
                              })
                          }}
                        >
                          <span>
                            {source.title}
                            {source.project && (
                              <span className="block text-xs text-muted-foreground">
                                {t(
                                  `assistant.history.source.${source.project.source ?? 'saved'}`
                                )}{' '}
                                ·{' '}
                                {t('assistant.history.version', {
                                  version: source.project.version,
                                })}
                              </span>
                            )}
                            {source.offset != null &&
                              source.endOffset != null && (
                                <span className="block text-xs text-muted-foreground">
                                  {t('assistant.sourceRange', {
                                    offset: source.offset,
                                    end: source.endOffset,
                                    total: source.totalCharacters,
                                    format: t(
                                      `assistant.sourceFormat.${source.format ?? 'unknown'}`
                                    ),
                                    version: source.version,
                                  })}
                                </span>
                              )}
                          </span>
                        </Button>
                        {source.project && (
                          <details className="text-xs">
                            <summary className="pnds-focus-ring">
                              {t('assistant.project.snapshotText')}
                            </summary>
                            <pre
                              dir="ltr"
                              tabIndex={0}
                              className="pnds-focus-ring max-h-40 select-text overflow-auto whitespace-pre-wrap [-webkit-user-select:text]"
                            >
                              {source.project.text}
                            </pre>
                          </details>
                        )}
                        {sourceNote?.owner === identity &&
                          sourceNote.key === assistantSourceKey(source) && (
                            <p
                              aria-live="polite"
                              className="text-xs text-muted-foreground"
                            >
                              {t(
                                `assistant.project.navigation.${sourceNote.kind}`
                              )}
                            </p>
                          )}
                      </div>
                    ))}
                  </nav>
                </details>
              )}
            </article>
          ))}
        </div>
      </div>
      {showLatest && (
        <div className="flex shrink-0 justify-center px-3 py-1">
          <Button
            size="sm"
            type="button"
            variant="ghost"
            onClick={() => {
              followingLatest.current = true
              setPausedReading(null)
              const panel = transcript.current
              if (panel) {
                panel.scrollTop = panel.scrollHeight
                panel.focus({ preventScroll: true })
              }
            }}
          >
            {t('assistant.latest')}
          </Button>
        </div>
      )}
      <div className="shrink-0 border-t border-(--pnds-border) p-3">
        {onCheck && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            <Button size="sm" variant="outline" onClick={onCheck}>
              {t('assistant.check.open')}
            </Button>
            <span className="text-muted-foreground">
              {t('assistant.check.independent')}
            </span>
          </div>
        )}
        <AssistantProjectControls identity={identity} />
        <AssistantAttachments />
        {(configured === false ||
          (configured === null && error) ||
          error === 'missingCredential' ||
          error === 'credentialStore') && (
          <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
            {configured === false && <p>{t('assistant.unconfigured')}</p>}
            <Button
              size="sm"
              variant="outline"
              onClick={() =>
                useSettingsStore.getState().openSettings('modelService')
              }
            >
              {t('assistant.settings')}
            </Button>
            {configured === null && phase === 'idle' && (
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  void useAssistantStore.getState().refreshConfiguration()
                }
              >
                {t('assistant.refreshConfiguration')}
              </Button>
            )}
          </div>
        )}
        {phase !== 'idle' && (
          <p role="status" className="mb-2 text-xs">
            {t(`assistant.${phase}`)}
          </p>
        )}
        {error && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {t(`assistant.error.${error}`)}
          </p>
        )}
        {editing && (
          <div className="mb-2 flex items-center justify-between gap-2 text-xs">
            <p>{t('assistant.chat.editingQuestion')}</p>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => useAssistantStore.getState().cancelEditing()}
            >
              {t('assistant.chat.cancelEditing')}
            </Button>
          </div>
        )}
        <form
          onSubmit={event => {
            event.preventDefault()
            if (canSend) void useAssistantStore.getState().send()
          }}
          className="flex flex-col gap-2"
        >
          <label htmlFor="creation-assistant-input" className="sr-only">
            {t('assistant.input')}
          </label>
          <textarea
            ref={composer}
            id="creation-assistant-input"
            className="pnds-focus-ring max-h-40 min-h-20 w-full resize-y rounded-md border border-(--pnds-border) bg-(--pnds-pill) p-2 text-sm"
            value={input}
            disabled={phase !== 'idle'}
            onChange={event =>
              useAssistantStore.getState().setInput(event.target.value)
            }
            onKeyDown={event => {
              if (
                event.key === 'Enter' &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing &&
                event.nativeEvent.keyCode !== 229
              ) {
                event.preventDefault()
                if (canSend) void useAssistantStore.getState().send()
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <div className="flex min-w-0 items-center gap-2">
              <AssistantContextUsage identity={identity}>
                <AssistantContextControls identity={identity} compact />
              </AssistantContextUsage>
              <span className="text-muted-foreground text-xs">
                {t('assistant.sendHint')}
              </span>
            </div>
            {phase === 'idle' ? (
              <Button size="sm" type="submit" disabled={!canSend}>
                {t(
                  editing
                    ? 'assistant.chat.sendBranch'
                    : error
                      ? 'assistant.retry'
                      : 'assistant.send'
                )}
              </Button>
            ) : (
              <Button
                size="sm"
                type="button"
                variant="outline"
                onClick={event => {
                  event.preventDefault()
                  useAssistantStore.getState().stop()
                }}
              >
                {t('assistant.stop')}
              </Button>
            )}
          </div>
        </form>
      </div>
    </section>
  )
}
