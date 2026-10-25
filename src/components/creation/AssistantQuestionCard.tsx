import { TooltipHint } from '@/components/ui/tooltip'
import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAssistantStore } from '@/store/assistant-store'
import type {
  AssistantQuestion,
  AssistantQuestionAnswer,
} from '@/lib/tauri-bindings'

function CreativeQuestionAnswer({
  question,
  busy,
  onAnswer,
}: {
  question: AssistantQuestion
  busy: boolean
  onAnswer: () => void
}) {
  const { t } = useTranslation()
  const [text, setText] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const inFlight = useRef(false)
  const first = useRef<HTMLButtonElement>(null)
  const input = useRef<HTMLTextAreaElement>(null)
  const disabled = busy || submitting
  useEffect(() => {
    if (question.options.length) first.current?.focus()
    else input.current?.focus()
  }, [question.options.length])
  const answer = async (value: AssistantQuestionAnswer) => {
    if (disabled || inFlight.current) return
    inFlight.current = true
    setSubmitting(true)
    onAnswer()
    try {
      await useAssistantStore.getState().answerQuestion(question.id, value)
      // A failed submission preserves the same live question for retry. A
      // successful one stays locked until its canonical answer replaces it.
      if (!useAssistantStore.getState().resumeError) return
    } catch {
      // Keep the authored answer available if the request could not be sent.
    }
    inFlight.current = false
    setSubmitting(false)
  }
  const sendText = () => {
    if (text.trim()) void answer({ optionId: null, text: text.trim() })
  }
  return (
    <form
      onSubmit={event => {
        event.preventDefault()
        sendText()
      }}
      className="space-y-3"
    >
      <fieldset disabled={disabled} className="min-w-0 space-y-2">
        <legend className="sr-only">{question.prompt}</legend>
        {question.options.map((option, index) => (
          <button
            key={option.id}
            ref={index === 0 ? first : undefined}
            type="button"
            onClick={() => void answer({ optionId: option.id, text: null })}
            className="pnds-focus-ring flex w-full min-w-0 items-start gap-3 rounded-md border border-(--pnds-border) p-3 text-start transition-colors hover:bg-accent disabled:cursor-default disabled:opacity-50"
          >
            <span className="min-w-0 flex-1 break-words">
              <span className="font-medium">{option.label}</span>
              {option.description && (
                <span className="mt-1 block text-xs text-muted-foreground">
                  {option.description}
                </span>
              )}
            </span>
            {question.recommendedOptionId === option.id && (
              <span className="shrink-0 rounded-md border border-(--pnds-border) px-1.5 py-0.5 text-xs text-muted-foreground">
                {t('assistant.question.recommended')}
              </span>
            )}
          </button>
        ))}
        <div className="text-xs text-muted-foreground">
          <label htmlFor={`question-answer-${question.id}`}>
            {t('assistant.question.ownAnswer')}
          </label>
          <div className="relative mt-2">
            <textarea
              ref={input}
              id={`question-answer-${question.id}`}
              value={text}
              onChange={event => setText(event.target.value)}
              onKeyDown={event => {
                if (
                  event.key === 'Enter' &&
                  !event.shiftKey &&
                  !event.nativeEvent.isComposing &&
                  event.nativeEvent.keyCode !== 229
                ) {
                  event.preventDefault()
                  sendText()
                }
              }}
              maxLength={4000}
              rows={2}
              placeholder={t('assistant.question.answerPlaceholder')}
              className="pnds-focus-ring block w-full min-w-0 resize-none rounded-md border border-(--pnds-border) bg-background py-3 pe-12 ps-3 text-start text-sm text-foreground"
            />
            <TooltipHint content={t('assistant.question.answerHint')}>
              <Button
                type="submit"
                size="icon-sm"
                variant={text.trim() ? 'default' : 'secondary'}
                disabled={disabled || !text.trim()}
                className="absolute end-2 bottom-2 size-7"
                aria-label={t('assistant.question.sendAnswer')}
              >
                <ArrowUp className="size-3.5" aria-hidden="true" />
              </Button>
            </TooltipHint>
          </div>
        </div>
      </fieldset>
    </form>
  )
}

export function AssistantQuestionCard({
  question,
  replyId,
  number,
}: {
  question: AssistantQuestion
  replyId: string
  number?: number
}) {
  const { t } = useTranslation()
  const active = useAssistantStore(state => state.activeQuestion)
  const busy = useAssistantStore(state => state.questionBusy)
  const conversationId = useAssistantStore(state => state.activeConversationId)
  const phase = useAssistantStore(state => state.phase)
  const conflict = question.materialConflict
  const prompt = conflict
    ? t('assistant.materialConflict.prompt', { path: conflict.path })
    : question.prompt
  const excerpt = (text: string) =>
    text.replace(/\r/g, '\\r').replace(/\n/g, '\\n\n').replace(/\t/g, '\\t')
  const optionLabel = (id: string, fallback: string) =>
    conflict
      ? t(`assistant.materialConflict.${id}`, { path: conflict.path })
      : fallback
  const [selection, setSelection] = useState<
    { optionId: string } | 'text' | null
  >(null)
  const [text, setText] = useState('')
  const [submittedHere, setSubmittedHere] = useState(false)
  const receipt = useRef<HTMLParagraphElement>(null)
  const first = useRef<HTMLInputElement>(null)
  const ownAnswer = useRef<HTMLTextAreaElement>(null)
  const current =
    !!active &&
    active.question.id === question.id &&
    active.taskId === question.taskId &&
    active.replyId === replyId &&
    replyId === question.scope.messageId &&
    active.conversationId === conversationId
  const ready =
    current &&
    active?.ready &&
    question.status === 'pending' &&
    phase === 'idle'
  const freeText = selection === 'text'
  useEffect(() => {
    if (ready) first.current?.focus()
  }, [ready])
  useEffect(() => {
    if (!ready && submittedHere) receipt.current?.focus()
  }, [ready, submittedHere])
  const submitted =
    question.answer?.text ??
    question.options.find(option => option.id === question.answer?.optionId)
      ?.label
  return (
    <section
      aria-label={`${t('assistant.question.title')}${number ? ` ${number}` : ''}`}
      className="creation-action-card my-3 min-w-0 space-y-3 rounded-lg border border-(--pnds-border) bg-(--pnds-pill) p-4 text-sm"
    >
      <p className="whitespace-pre-wrap break-words font-medium">
        {number && (
          <span className="me-2 text-xs text-muted-foreground">
            {t('assistant.question.number', { number })}
          </span>
        )}
        {prompt}
      </p>
      {conflict && (
        <div className="min-w-0 space-y-2 text-xs">
          <p className="text-muted-foreground">
            {t('assistant.materialConflict.difference', {
              line: conflict.firstChangedLine,
            })}
          </p>
          <dl className="min-w-0 space-y-2">
            <div>
              <dt>{t('assistant.materialConflict.saved')}</dt>
              <dd>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-(--pnds-border) p-2">
                  {excerpt(conflict.savedExcerpt)}
                </pre>
              </dd>
            </div>
            <div>
              <dt>{t('assistant.materialConflict.candidate')}</dt>
              <dd>
                <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words rounded-md border border-(--pnds-border) p-2">
                  {excerpt(conflict.candidateExcerpt)}
                </pre>
              </dd>
            </div>
          </dl>
          {conflict.truncated && (
            <p className="text-muted-foreground">
              {t('assistant.materialConflict.bounded')}
            </p>
          )}
          <p>
            {t('assistant.materialConflict.recommendation', {
              path: conflict.coexistPath,
            })}
          </p>
          {current && !ready && (
            <p role="alert">{t('assistant.materialConflict.revalidate')}</p>
          )}
        </div>
      )}
      {ready && !conflict ? (
        <CreativeQuestionAnswer
          question={question}
          busy={busy}
          onAnswer={() => setSubmittedHere(true)}
        />
      ) : ready ? (
        <form
          onSubmit={event => {
            event.preventDefault()
            if (!busy && selection && (!freeText || text.trim())) {
              setSubmittedHere(true)
              void useAssistantStore.getState().answerQuestion(
                question.id,
                freeText
                  ? { optionId: null, text: text.trim() }
                  : {
                      optionId:
                        typeof selection === 'object'
                          ? selection.optionId
                          : null,
                      text: null,
                    }
              )
            }
          }}
          className="space-y-3"
        >
          <fieldset disabled={busy} className="min-w-0 space-y-2">
            <legend className="sr-only">{prompt}</legend>
            {question.options.map((option, index) => (
              <label
                key={option.id}
                className="flex min-w-0 cursor-pointer items-start gap-2 rounded-md border border-(--pnds-border) p-3"
              >
                <input
                  ref={index === 0 ? first : undefined}
                  type="radio"
                  name={`question-${question.id}`}
                  value={option.id}
                  checked={
                    typeof selection === 'object' &&
                    selection?.optionId === option.id
                  }
                  onChange={() => setSelection({ optionId: option.id })}
                  className="pnds-focus-ring mt-1 shrink-0"
                />
                <span className="min-w-0 break-words">
                  <span className="font-medium">
                    {optionLabel(option.id, option.label)}
                  </span>
                  {question.recommendedOptionId === option.id && (
                    <span className="ms-2 text-xs text-muted-foreground">
                      {t('assistant.question.recommended')}
                    </span>
                  )}
                  {(option.description || conflict) && (
                    <span className="mt-1 block text-xs text-muted-foreground">
                      {conflict
                        ? t(
                            `assistant.materialConflict.${option.id}Consequence`,
                            {
                              path: conflict.path,
                              coexistPath: conflict.coexistPath,
                            }
                          )
                        : option.description}
                    </span>
                  )}
                </span>
              </label>
            ))}
            <label className="flex cursor-pointer items-start gap-2 rounded-md border border-(--pnds-border) p-3">
              <input
                ref={question.options.length ? undefined : first}
                type="radio"
                name={`question-${question.id}`}
                value="__free__"
                checked={freeText}
                onChange={() => {
                  setSelection('text')
                  queueMicrotask(() => ownAnswer.current?.focus())
                }}
                className="pnds-focus-ring mt-1 shrink-0"
              />
              {t('assistant.question.ownAnswer')}
            </label>
            {freeText && (
              <textarea
                ref={ownAnswer}
                aria-label={t('assistant.question.ownAnswer')}
                value={text}
                onChange={event => setText(event.target.value)}
                maxLength={4000}
                rows={3}
                className="pnds-focus-ring w-full min-w-0 resize-y rounded-md border border-(--pnds-border) bg-background p-3 text-start"
              />
            )}
          </fieldset>
          <p className="text-xs text-muted-foreground">
            {t('assistant.question.waiting')}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="submit"
              size="sm"
              disabled={busy || !selection || (freeText && !text.trim())}
            >
              {t('assistant.question.submit')}
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={busy}
              onClick={() => useAssistantStore.getState().stop()}
            >
              {t('assistant.resources.cancel')}
            </Button>
          </div>
        </form>
      ) : (
        <div className="space-y-2">
          <p
            ref={receipt}
            tabIndex={-1}
            className="pnds-focus-ring whitespace-pre-wrap break-words text-xs text-muted-foreground"
          >
            {question.status === 'answered'
              ? t('assistant.question.answered', {
                  answer: question.answer?.optionId
                    ? optionLabel(question.answer.optionId, submitted ?? '')
                    : submitted,
                })
              : question.status === 'cancelled'
                ? t('assistant.question.cancelled')
                : current
                  ? t('assistant.question.continue')
                  : t('assistant.question.historical')}
          </p>
          {current && question.status === 'pending' && (
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                disabled={phase !== 'idle' || busy}
                onClick={() =>
                  void useAssistantStore.getState().send(false, true)
                }
              >
                {t('assistant.continue')}
              </Button>
              {conflict && (
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={phase !== 'idle' || busy}
                  onClick={() => useAssistantStore.getState().stop()}
                >
                  {t('assistant.resources.cancel')}
                </Button>
              )}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
