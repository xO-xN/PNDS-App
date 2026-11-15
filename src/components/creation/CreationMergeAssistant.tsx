import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { ArrowUp, LoaderCircle, Square, Undo2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useAssistantStore } from '@/store/assistant-store'
import { useMergeAssistantStore } from '@/store/merge-assistant-store'
import { useCreationMergeStore } from '@/store/creation-merge-store'
import { useSettingsStore } from '@/store/settings-store'
import type { AssistantQuestion } from '@/lib/tauri-bindings'
import { AssistantMarkdown } from './AssistantMarkdown'
import { CreationMergeAssistantChanges } from './CreationMergeAssistantChanges'

function MergeQuestion({
  question,
  ready,
}: {
  question: AssistantQuestion
  ready: boolean
}) {
  const { t } = useTranslation()
  const [answer, setAnswer] = useState('')
  const receipt =
    question.answer?.text ??
    question.options.find(option => option.id === question.answer?.optionId)
      ?.label
  return (
    <div className="mt-3 space-y-2 border-s-2 border-(--pnds-border) ps-3 text-sm">
      <p>{question.prompt}</p>
      {question.status === 'answered' ? (
        <p className="text-muted-foreground">
          {t('assistant.question.answered', { answer: receipt })}
        </p>
      ) : question.status === 'cancelled' ? (
        <p className="text-muted-foreground">
          {t('assistant.question.cancelled')}
        </p>
      ) : !ready ? (
        <p className="text-muted-foreground">
          {t('assistant.question.historical')}
        </p>
      ) : (
        <form
          onSubmit={event => {
            event.preventDefault()
            if (answer.trim())
              void useMergeAssistantStore
                .getState()
                .answer(question.id, { optionId: null, text: answer.trim() })
          }}
        >
          <fieldset className="min-w-0 space-y-2">
            <legend className="sr-only">{question.prompt}</legend>
            {question.options.map(option => (
              <button
                key={option.id}
                type="button"
                className="pnds-focus-ring flex w-full min-w-0 items-start justify-between gap-3 rounded-md border border-(--pnds-border) px-3 py-2 text-start hover:bg-accent"
                onClick={() =>
                  void useMergeAssistantStore
                    .getState()
                    .answer(question.id, { optionId: option.id, text: null })
                }
              >
                <span>
                  <span className="font-medium">{option.label}</span>
                  {option.description && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {option.description}
                    </span>
                  )}
                </span>
                {question.recommendedOptionId === option.id && (
                  <span className="shrink-0 text-xs text-muted-foreground">
                    {t('assistant.question.recommended')}
                  </span>
                )}
              </button>
            ))}
            <label className="sr-only" htmlFor={`merge-answer-${question.id}`}>
              {t('assistant.question.ownAnswer')}
            </label>
            <div className="relative">
              <textarea
                id={`merge-answer-${question.id}`}
                value={answer}
                maxLength={4000}
                rows={2}
                placeholder={t('assistant.question.answerPlaceholder')}
                className="pnds-focus-ring block w-full resize-none rounded-md border border-(--pnds-border) bg-background py-2 pe-11 ps-3 text-start"
                onChange={event => setAnswer(event.target.value)}
                onKeyDown={event => {
                  if (
                    event.key === 'Enter' &&
                    !event.shiftKey &&
                    !event.nativeEvent.isComposing &&
                    event.nativeEvent.keyCode !== 229
                  ) {
                    event.preventDefault()
                    if (answer.trim())
                      void useMergeAssistantStore
                        .getState()
                        .answer(question.id, {
                          optionId: null,
                          text: answer.trim(),
                        })
                  }
                }}
              />
              <Button
                type="submit"
                size="icon-sm"
                disabled={!answer.trim()}
                aria-label={t('assistant.question.sendAnswer')}
                className="absolute end-2 bottom-2"
              >
                <ArrowUp className="size-3.5" aria-hidden="true" />
              </Button>
            </div>
          </fieldset>
        </form>
      )}
    </div>
  )
}

/** The existing assistant tab renders this only while its candidate is current. */
export function CreationMergeAssistant({
  identity,
  candidateId,
}: {
  identity: string
  candidateId: string
}) {
  const { t, i18n } = useTranslation()
  const scope = useMergeAssistantStore(state => state.scope)
  const tasks = useMergeAssistantStore(state => state.tasks)
  const input = useMergeAssistantStore(state => state.input)
  const response = useMergeAssistantStore(state => state.response)
  const phase = useMergeAssistantStore(state => state.phase)
  const loading = useMergeAssistantStore(state => state.loading)
  const error = useMergeAssistantStore(state => state.error)
  const activeTaskId = useMergeAssistantStore(state => state.activeTaskId)
  const candidate = useCreationMergeStore(state => state.candidate)
  const mergeBusy = useCreationMergeStore(state => state.busy)
  const configured = useAssistantStore(state => state.configured)
  const transcript = useRef<HTMLDivElement>(null)
  const following = useRef(true)
  const current =
    scope?.identity === identity &&
    scope.candidateId === candidateId &&
    candidate?.id === candidateId
  const liveTask = tasks.find(task => task.id === activeTaskId)
  const available =
    current && candidate?.phase === 'active' && !mergeBusy && !loading
  const executing =
    phase === 'starting' || phase === 'running' || phase === 'stopping'
  const owned =
    current &&
    (!!candidate?.assistantOwner ||
      phase === 'waiting' ||
      executing ||
      liveTask?.state === 'running' ||
      liveTask?.state === 'waiting')
  const canResume =
    available &&
    phase === 'idle' &&
    liveTask?.checkpoint &&
    !liveTask.questions.some(question => question.status === 'pending')
  const canSend =
    available &&
    phase === 'idle' &&
    !candidate?.assistantOwner &&
    !liveTask &&
    configured !== false &&
    !!input.trim()
  useEffect(() => {
    void useMergeAssistantStore.getState().activate(identity, candidateId)
    if (useAssistantStore.getState().configured === null)
      void useAssistantStore.getState().refreshConfiguration()
  }, [identity, candidateId])
  useLayoutEffect(() => {
    if (following.current && transcript.current)
      transcript.current.scrollTop = transcript.current.scrollHeight
  }, [tasks, response])
  return (
    <section
      className="creation-assistant flex min-h-0 flex-1 flex-col"
      aria-label={t('creation.merge.assistant.title')}
    >
      <header className="flex items-start justify-between gap-3 border-b border-(--pnds-border) px-4 py-3">
        <div>
          <h2 className="text-sm font-medium">
            {t('creation.merge.assistant.title')}
          </h2>
          <p className="mt-1 text-xs text-muted-foreground">
            {t(
              candidate?.relation === 'fastForward'
                ? 'creation.merge.assistant.fast'
                : 'creation.merge.assistant.intro'
            )}
          </p>
        </div>
        {candidate?.canUndo && (
          <Button
            variant="ghost"
            size="sm"
            disabled={!available || phase !== 'idle'}
            onClick={() => void useMergeAssistantStore.getState().undo()}
          >
            <Undo2 className="size-3.5" aria-hidden="true" />
            {t('creation.merge.assistant.undo')}
          </Button>
        )}
      </header>
      <div
        ref={transcript}
        className="creation-assistant-transcript min-h-0 flex-1 overflow-auto p-4 [overflow-wrap:anywhere]"
        role="region"
        aria-label={t('creation.merge.assistant.title')}
        tabIndex={0}
        onScroll={() => {
          const node = transcript.current
          if (node)
            following.current =
              node.scrollHeight - node.clientHeight - node.scrollTop < 48
        }}
      >
        {current &&
          tasks.map(task => (
            <article key={task.id} className="mb-6 space-y-3">
              <div className="assistant-message-user ms-auto w-fit max-w-[88%] rounded-2xl px-4 py-3">
                <AssistantMarkdown text={task.input} variant="compact" />
              </div>
              <AssistantMarkdown
                text={
                  task.id === activeTaskId && phase === 'running'
                    ? response
                    : task.response
                }
                streaming={task.id === activeTaskId && phase === 'running'}
              />
              {task.questions.map(question => (
                <MergeQuestion
                  key={question.id}
                  question={question}
                  ready={
                    !!available &&
                    phase === 'waiting' &&
                    task.id === activeTaskId &&
                    (!task.writable || candidate?.assistantOwner === task.id)
                  }
                />
              ))}
              <CreationMergeAssistantChanges
                identity={identity}
                candidateId={candidateId}
                taskId={task.id}
                revision={candidate?.revision ?? 0}
              />
            </article>
          ))}
        {(loading || phase === 'starting') && (
          <LoaderCircle
            className="size-4 animate-spin text-muted-foreground"
            aria-hidden="true"
          />
        )}
      </div>
      <form
        className="creation-assistant-composer shrink-0 space-y-2 border-t border-(--pnds-border) p-3"
        onSubmit={event => {
          event.preventDefault()
          if (canSend) void useMergeAssistantStore.getState().send()
        }}
      >
        {error && (
          <p role="alert" className="text-xs text-destructive">
            {i18n.exists(`assistant.errors.${error}`)
              ? t(`assistant.errors.${error}`)
              : t('creation.merge.assistant.failed')}
          </p>
        )}
        {configured === false && (
          <div className="flex items-center gap-2 text-xs">
            <p>{t('assistant.unconfigured')}</p>
            <Button
              type="button"
              size="sm"
              variant="outline"
              onClick={() =>
                useSettingsStore.getState().openSettings('modelService')
              }
            >
              {t('assistant.settings')}
            </Button>
          </div>
        )}
        {!available && candidate?.phase !== 'active' && (
          <p className="text-xs text-muted-foreground">
            {t('creation.merge.assistant.unavailable')}
          </p>
        )}
        <label className="sr-only" htmlFor={`merge-assistant-${candidateId}`}>
          {t('creation.merge.assistant.placeholder')}
        </label>
        <textarea
          id={`merge-assistant-${candidateId}`}
          value={current ? input : ''}
          maxLength={4000}
          rows={3}
          disabled={
            !available ||
            phase !== 'idle' ||
            !!candidate?.assistantOwner ||
            !!liveTask
          }
          placeholder={t('creation.merge.assistant.placeholder')}
          className="pnds-focus-ring block w-full resize-none rounded-md border border-(--pnds-border) bg-background px-3 py-2 text-start text-sm disabled:opacity-50"
          onChange={event =>
            useMergeAssistantStore.getState().setInput(event.target.value)
          }
          onKeyDown={event => {
            if (
              event.key === 'Enter' &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing &&
              event.nativeEvent.keyCode !== 229
            ) {
              event.preventDefault()
              if (canSend) void useMergeAssistantStore.getState().send()
            }
          }}
        />
        <div className="flex justify-end gap-2">
          {canResume && (
            <Button
              type="button"
              size="sm"
              onClick={() => void useMergeAssistantStore.getState().resume()}
            >
              {t('creation.merge.assistant.continue')}
            </Button>
          )}
          {owned ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={phase === 'stopping'}
              onClick={() =>
                void useMergeAssistantStore
                  .getState()
                  .stop()
                  .catch(() => undefined)
              }
            >
              <Square className="size-3.5" aria-hidden="true" />
              {t('creation.merge.assistant.stop')}
            </Button>
          ) : (
            !canResume && (
              <Button type="submit" size="sm" disabled={!canSend}>
                <ArrowUp className="size-3.5" aria-hidden="true" />
                {t('creation.merge.assistant.send')}
              </Button>
            )
          )}
        </div>
      </form>
    </section>
  )
}
