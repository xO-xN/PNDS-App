import { TooltipHint } from '@/components/ui/tooltip'
import { AssistantQuestionCard } from './AssistantQuestionCard'
import { AssistantResourceApproval } from './AssistantResourceApproval'
import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react'
import { useTranslation } from 'react-i18next'
import { AssistantMessageText } from './AssistantMessageText'
import { AssistantThoughtLine } from './AssistantThoughtLine'
import { AssistantModeSwitch } from './AssistantModeSwitch'
import { Pencil, LoaderCircle, ArrowUp, Square } from 'lucide-react'
import { conversationMessages } from '@/lib/assistant-conversations'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useSettingsStore } from '@/store/settings-store'
import { Button } from '@/components/ui/button'
import type { AssistantMessage } from '@/lib/assistant-types'
import { AssistantHistorySnapshots } from './AssistantHistorySnapshots'
import { AssistantHistoryControls } from './AssistantHistoryControls'
import { AssistantChats } from './AssistantChats'
import { AssistantDocumentSources } from './AssistantDocumentSources'
import { consultedDocumentCount } from '@/lib/assistant-source-groups'
import { AssistantHandoffCard } from './AssistantHandoffCard'
import { AssistantLiveProposals } from './AssistantLiveProposals'
import { useAssistantProposalStore } from '@/store/assistant-proposal-store'
import {
  AssistantProjectControls,
  AssistantProjectStatus,
} from './AssistantProjectControls'
import { AssistantAttachments } from './AssistantAttachments'
import { AssistantFileReferences } from './AssistantFileReferences'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import { assistantSourceKey } from '@/lib/assistant-project'
import { commands } from '@/lib/tauri-bindings'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useCreationMaterialsStore } from '@/store/creation-materials-store'
import { AssistantContextUsage } from './AssistantContextUsage'
import {
  AssistantContextControls,
  AssistantSummaryView,
} from './AssistantContextControls'

const BOTTOM_THRESHOLD = 48

function updateBottomFade(panel: HTMLDivElement): void {
  panel.dataset.bottomFade = String(
    panel.scrollHeight - panel.clientHeight - panel.scrollTop > 1
  )
}

/** Discussion owns no file access or execution. Its only request entry is the assistant store. */
export function CreationAssistant({
  identity,
  renderMessageCards,
}: {
  identity: string
  renderMessageCards?: (message: AssistantMessage) => ReactNode
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
  const questionNumbers = new Map<string, number>()
  for (const message of messages)
    for (const question of message.questions ?? [])
      if (!question.materialConflict && !questionNumbers.has(question.id))
        questionNumbers.set(question.id, questionNumbers.size + 1)
  const navigationIdentity = `${identity}:${activeConversationId ?? 'original'}`
  const phase = useAssistantStore(state => state.phase)
  const organizing = useAssistantStore(state => state.organizing)
  const modelName = useAssistantStore(state => state.modelConfig?.model)
  const mode = useAssistantStore(state => state.mode)
  const handoffDraftError = useAssistantStore(state => state.handoffDraftError)
  const error = useAssistantStore(state => state.error)
  const canContinue = useAssistantStore(state => state.canContinue)
  const paused = useAssistantStore(state => state.paused)
  const resourceApproval = useAssistantStore(state => state.resourceApproval)
  const activeQuestion = useAssistantStore(state => state.activeQuestion)
  const resumeRestored = useAssistantStore(state => state.resumeRestored)
  const resumeError = useAssistantStore(state => state.resumeError)
  const questionCancelError = useAssistantStore(
    state => state.questionCancelError
  )
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
  const questionHistorySummaries = useRef(new Map<string, HTMLElement>())
  const submittedQuestion = useRef<{
    owner: string
    replyId: string
    questionId: string
  } | null>(null)
  const previousNavigation = useRef<{
    identity: string
    view: string
    target: string | null
    userMessage: string | null
  } | null>(null)
  const userMessage =
    messages.filter(message => message.role === 'user').at(-1)?.id ?? null
  const canSend =
    !resourceApproval &&
    !activeQuestion &&
    phase === 'idle' &&
    !planning &&
    !whole &&
    configured &&
    input.trim() &&
    historyState === 'ready' &&
    !historyBusy &&
    !historySaveError
  const referencesDisabled =
    phase !== 'idle' || !!resourceApproval || !!activeQuestion || historyBusy
  const workingMessage = messages
    .filter(
      message => message.role === 'assistant' && message.status === 'pending'
    )
    .at(-1)
  const workingLabel = t(
    phase === 'responding' && workingMessage?.text
      ? 'assistant.outputting'
      : `assistant.${phase}`
  )
  const workingIndicator = phase !== 'idle' && (
    <span role="status" className="sr-only">
      <span className="sr-only">{workingLabel}</span>
    </span>
  )
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
        updateBottomFade(panel)
        return
      }
    }
    if (newSend) followingLatest.current = true
    if (followingLatest.current) {
      panel.scrollTop = panel.scrollHeight
    }
    updateBottomFade(panel)
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
      updateBottomFade(panel)
    })
    observer.observe(panel)
    observer.observe(content)
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [navigationIdentity, view, userMessage])
  useLayoutEffect(() => {
    const submitted = submittedQuestion.current
    if (!submitted) return
    if (submitted.owner !== navigationIdentity) {
      submittedQuestion.current = null
      return
    }
    const question = messages
      .find(message => message.id === submitted.replyId)
      ?.questions?.find(question => question.id === submitted.questionId)
    if (!question || question.status === 'pending') return
    questionHistorySummaries.current
      .get(submitted.replyId)
      ?.focus({ preventScroll: true })
    submittedQuestion.current = null
  }, [messages, navigationIdentity])

  return (
    <section
      aria-label={t('assistant.title')}
      className="creation-assistant flex min-h-0 flex-1 flex-col"
    >
      <AssistantHistoryControls identity={identity}>
        <AssistantChats />
      </AssistantHistoryControls>
      <div
        ref={transcript}
        className="creation-assistant-transcript pnds-focus-ring min-h-0 flex-1 overflow-auto p-4 [overflow-wrap:anywhere]"
        role="region"
        tabIndex={0}
        aria-label={t('assistant.messages')}
        onScroll={event => {
          if (view !== 'discussion') return
          const panel = event.currentTarget
          followingLatest.current =
            panel.scrollHeight - panel.clientHeight - panel.scrollTop <=
            BOTTOM_THRESHOLD
          updateBottomFade(panel)
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
              {message.id === workingMessage?.id && workingIndicator}
              {message.questions?.some(
                question => question.status !== 'pending'
              ) && (
                <details className="mb-3 text-xs">
                  <summary
                    ref={element => {
                      if (element)
                        questionHistorySummaries.current.set(
                          message.id,
                          element
                        )
                      else questionHistorySummaries.current.delete(message.id)
                    }}
                    className="pnds-focus-ring rounded-sm py-1 text-muted-foreground"
                    onClick={() => {
                      followingLatest.current = false
                    }}
                  >
                    {t('assistant.question.history', {
                      count: message.questions.filter(
                        question => question.status !== 'pending'
                      ).length,
                    })}
                  </summary>
                  {message.questions
                    .filter(question => question.status !== 'pending')
                    .map(question => (
                      <AssistantQuestionCard
                        key={question.id}
                        question={question}
                        replyId={message.id}
                        number={questionNumbers.get(question.id)}
                      />
                    ))}
                </details>
              )}
              <AssistantMessageText
                message={message}
                workingLabel={
                  message.id === workingMessage?.id ? workingLabel : undefined
                }
              />
              {message.questions
                ?.filter(question => question.status === 'pending')
                .map(question => (
                  <AssistantQuestionCard
                    key={question.id}
                    question={question}
                    replyId={message.id}
                    number={questionNumbers.get(question.id)}
                    onAnswer={() => {
                      submittedQuestion.current = {
                        owner: navigationIdentity,
                        replyId: message.id,
                        questionId: question.id,
                      }
                    }}
                  />
                ))}
              {message.role === 'assistant' && (
                <AssistantResourceApproval replyId={message.id} />
              )}
              {message.role === 'user' &&
                !message.attachments?.length &&
                !message.proposals?.length && (
                  <div className="mt-2 flex justify-end">
                    <TooltipHint content={t('assistant.chat.editQuestionHint')}>
                      <button
                        type="button"
                        className="pnds-focus-ring inline-flex size-7 items-center justify-center rounded-md opacity-60 hover:opacity-100 focus-visible:opacity-100 disabled:opacity-25"
                        aria-label={t('assistant.chat.editQuestion')}
                        disabled={
                          phase !== 'idle' ||
                          !!resourceApproval ||
                          !!activeQuestion ||
                          historyState !== 'ready' ||
                          historyBusy ||
                          !!historySaveError
                        }
                        onClick={() => {
                          useAssistantStore.getState().beginEditing(message.id)
                          composer.current?.focus()
                        }}
                      >
                        <Pencil className="size-3.5" aria-hidden="true" />
                      </button>
                    </TooltipHint>
                  </div>
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
              {!historicalMessageIds.includes(message.id) &&
                renderMessageCards?.(message)}
              {message.sources.length > 0 && (
                <details className="mt-3 text-xs">
                  <summary className="pnds-focus-ring text-muted-foreground rounded-sm py-1">
                    {t(
                      message.sources.some(
                        source => source.project || source.material
                      )
                        ? 'assistant.project.sourceCount'
                        : 'assistant.sourceCount',
                      {
                        count: consultedDocumentCount(message.sources),
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
                    <AssistantDocumentSources sources={message.sources} />
                    {message.sources
                      .filter(source => source.project || source.material)
                      .map(source => (
                        <div
                          key={assistantSourceKey(source)}
                          className="w-full"
                        >
                          <Button
                            key={`${source.locale}:${source.version ?? ''}:${source.docId}:${source.sectionId}:${source.format ?? ''}:${source.offset ?? ''}:${source.endOffset ?? ''}`}
                            size="sm"
                            variant="link"
                            className="h-auto max-w-full whitespace-normal px-0 text-start"
                            onClick={() => {
                              if (source.material) {
                                useCreationMaterialsStore
                                  .getState()
                                  .open(
                                    identity,
                                    source.material.material.id,
                                    source.material.material.version
                                  )
                              } else if (source.project) {
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
                              }
                            }}
                          >
                            <span>
                              {source.title}
                              {source.material && (
                                <span className="block text-xs text-muted-foreground">
                                  {t('assistant.material.source')}
                                </span>
                              )}
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
                          {(source.project || source.material) && (
                            <details className="text-xs">
                              <summary className="pnds-focus-ring">
                                {t(
                                  source.material
                                    ? 'assistant.material.snapshotText'
                                    : 'assistant.project.snapshotText'
                                )}
                              </summary>
                              {source.material && (
                                <p className="my-1 text-muted-foreground">
                                  {t('assistant.material.snapshotNote')}
                                </p>
                              )}
                              <pre
                                dir="ltr"
                                tabIndex={0}
                                className="pnds-focus-ring max-h-40 select-text overflow-auto whitespace-pre-wrap [-webkit-user-select:text]"
                              >
                                {source.material?.text ?? source.project?.text}
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
          {!workingMessage && workingIndicator && (
            <article className="mb-6 min-w-0 w-full py-1">
              <p className="mb-2 text-xs text-muted-foreground">
                {t('assistant.title')}
              </p>
              {workingIndicator}
              <AssistantThoughtLine
                status="pending"
                label={workingLabel}
                entries={[]}
                renderEntry={() => null}
              />
            </article>
          )}
        </div>
      </div>
      <div className="creation-assistant-composer shrink-0 border-t border-(--pnds-border) p-3">
        <AssistantProjectStatus />
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
        {phase === 'idle' && paused && canContinue && (
          <p role="status" className="text-muted-foreground text-xs">
            {t(
              resumeRestored ? 'assistant.resume.restored' : 'assistant.paused'
            )}
          </p>
        )}
        {questionCancelError && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {t('assistant.question.cancelFailed')}
          </p>
        )}
        {resumeError && (
          <p role="alert" className="mb-2 text-sm text-destructive">
            {t('assistant.resume.error')}
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
          data-assistant-reference-drop={identity}
          data-assistant-reference-disabled={referencesDisabled || undefined}
          onSubmit={event => {
            event.preventDefault()
            if (canSend)
              void useAssistantStore.getState().send(false, canContinue)
          }}
          className="group/reference flex flex-col gap-2"
        >
          <label htmlFor="creation-assistant-input" className="sr-only">
            {t('assistant.input')}
          </label>
          <textarea
            ref={composer}
            id="creation-assistant-input"
            aria-describedby="creation-assistant-input-hint"
            className="pnds-focus-ring max-h-40 min-h-24 w-full resize-none rounded-md border border-(--pnds-border) bg-(--pnds-pill) p-3 text-sm"
            placeholder={t(
              mode === 'discussion'
                ? 'assistant.workflow.placeholder'
                : 'assistant.workflow.workPlaceholder'
            )}
            value={input}
            disabled={!!resourceApproval || !!activeQuestion || historyBusy}
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
                if (canSend)
                  void useAssistantStore.getState().send(false, canContinue)
              }
            }}
          />
          <span
            aria-hidden="true"
            className="hidden rounded-md border border-dashed p-2 text-xs text-muted-foreground group-data-[assistant-reference-drag-over]/reference:block"
          >
            {t('assistant.reference.drop')}
          </span>
          <AssistantFileReferences
            key={navigationIdentity}
            identity={identity}
            conversationId={activeConversationId}
            disabled={referencesDisabled}
          />
          {handoffDraftError && (
            <p role="alert" className="text-xs text-destructive">
              {t('assistant.handoff.draftError')}
            </p>
          )}
          <span id="creation-assistant-input-hint" className="sr-only">
            {t('assistant.sendHint')}
          </span>
          <div className="flex min-w-0 flex-wrap items-center gap-1">
            <AssistantModeSwitch
              value={mode}
              disabled={
                phase !== 'idle' ||
                !!resourceApproval ||
                !!activeQuestion ||
                historyBusy
              }
              onChange={next => useAssistantStore.getState().setMode(next)}
            />
            <AssistantContextUsage identity={identity}>
              <AssistantContextControls identity={identity} compact />
              <AssistantProjectControls identity={identity} />
            </AssistantContextUsage>
            <div className="ms-auto flex min-w-0 items-center gap-4">
              {modelName && (
                <TooltipHint content={modelName} overflowOnly>
                  <span className="max-w-40 truncate text-xs text-muted-foreground">
                    {modelName}
                  </span>
                </TooltipHint>
              )}
              {phase === 'idle' ? (
                <TooltipHint
                  content={
                    editing
                      ? t('assistant.chat.sendBranch')
                      : canContinue
                        ? t('assistant.continue')
                        : error
                          ? t('assistant.retry')
                          : undefined
                  }
                >
                  <Button
                    size="icon"
                    type="submit"
                    variant={canSend ? 'default' : 'secondary'}
                    className="size-[30px] shrink-0"
                    disabled={!canSend}
                    aria-label={t(
                      editing
                        ? 'assistant.chat.sendBranch'
                        : canContinue
                          ? 'assistant.continue'
                          : error
                            ? 'assistant.retry'
                            : 'assistant.send'
                    )}
                  >
                    <ArrowUp className="size-4" aria-hidden="true" />
                  </Button>
                </TooltipHint>
              ) : (
                <TooltipHint
                  content={t(
                    organizing
                      ? 'assistant.workflow.stopSummaryHint'
                      : phase === 'pausing'
                        ? 'assistant.workflow.pausingHint'
                        : 'assistant.workflow.stopHint'
                  )}
                >
                  <Button
                    size="icon"
                    type="button"
                    variant="outline"
                    className="relative size-[30px] shrink-0 border-(--pnds-accent) text-(--pnds-accent-text)"
                    aria-label={t(
                      organizing ? 'assistant.stop' : 'assistant.pause'
                    )}
                    disabled={phase === 'pausing'}
                    onClick={event => {
                      event.preventDefault()
                      useAssistantStore.getState().pause()
                    }}
                  >
                    <LoaderCircle
                      className="absolute size-5 animate-spin motion-reduce:animate-none"
                      aria-hidden="true"
                    />
                    <Square
                      className="size-1.5 fill-current"
                      aria-hidden="true"
                    />
                  </Button>
                </TooltipHint>
              )}
            </div>
          </div>
        </form>
      </div>
    </section>
  )
}
