import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { commands, type AssistantSummarySections } from '@/lib/tauri-bindings'
import {
  selectAssistantContext,
  summaryInput,
  SUMMARY_FIELDS,
} from '@/lib/assistant-context'
import { buildAssistantMessages } from '@/lib/assistant-flow'
import { useAssistantStore } from '@/store/assistant-store'
import { AssistantUsageStatistics } from './AssistantContextUsage'

export function AssistantSummaryView({
  sections,
}: {
  sections: AssistantSummarySections
}) {
  const { t } = useTranslation()
  return (
    <div className="space-y-2 text-sm [overflow-wrap:anywhere]">
      {SUMMARY_FIELDS.map(field => (
        <div key={field}>
          <p className="font-medium">{t(`assistant.summary.${field}`)}</p>
          {sections[field].length ? (
            <ul className="list-inside list-disc space-y-1">
              {sections[field].map((item, index) => (
                <li key={index}>
                  {item.text}
                  <span className="ms-1 inline-flex flex-wrap gap-1">
                    {item.sourceIds.map(id => (
                      <Button
                        key={id}
                        size="sm"
                        type="button"
                        variant="ghost"
                        onClick={() =>
                          useAssistantStore.getState().returnToMessage(id)
                        }
                      >
                        {t('assistant.summary.source', { id })}
                      </Button>
                    ))}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted-foreground">
              {t('assistant.summary.none')}
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

export function AssistantContextControls({ identity }: { identity: string }) {
  const { t } = useTranslation()
  const messages = useAssistantStore(state => state.messages)
  const config = useAssistantStore(state => state.modelConfig)
  const phase = useAssistantStore(state => state.phase)
  const historyState = useAssistantStore(state => state.historyState)
  const busy = useAssistantStore(state => state.historyBusy)
  const saveError = useAssistantStore(state => state.historySaveError)
  const draft = useAssistantStore(state => state.summaryDraft)
  const partial = useAssistantStore(state => state.summaryText)
  const organizing = useAssistantStore(state => state.organizing)
  const [reviewOwner, setReviewOwner] = useState<string | null>(null)
  const [roundLimit, setRoundLimit] = useState('8')
  const selection = selectAssistantContext(messages, config ?? undefined)
  const limit = Number(roundLimit)
  const validLimit = Number.isSafeInteger(limit) && limit >= 1 && limit <= 200
  const prepared = config
    ? summaryInput(messages, config, validLimit ? limit : 8)
    : null
  const review = reviewOwner === identity
  const [estimate, setEstimate] = useState<{
    input: string
    config: typeof config
    tokens: number | null
    bytes: number
    exceeded: boolean
  } | null>(null)
  const summaryPayload = prepared?.input
  useEffect(() => {
    if (!review || !config || !summaryPayload || !validLimit) return
    let stale = false
    void commands
      .measureAssistantContext(
        config,
        buildAssistantMessages([], summaryPayload, {
          owner: identity,
          config,
          projectReading: false,
          purpose: 'summary',
        })
      )
      .then(result => {
        if (!stale && result.status === 'ok')
          setEstimate({
            input: summaryPayload,
            config,
            tokens: result.data.estimatedTokens,
            bytes: result.data.utf8Bytes,
            exceeded: result.data.exceeded !== null,
          })
      })
      .catch(() => undefined)
    return () => {
      stale = true
    }
  }, [review, config, summaryPayload, identity, validLimit])
  const currentEstimate =
    estimate?.input === prepared?.input && estimate?.config === config
      ? estimate
      : null
  const disabled =
    phase !== 'idle' ||
    historyState !== 'ready' ||
    busy ||
    saveError === 'staleHistory'
  return (
    <div className="space-y-2 text-xs">
      {phase === 'idle' && (
        <p>
          {t('assistant.context.selection', {
            count: selection.recent.length,
            excluded: selection.excluded,
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          type="button"
          variant="outline"
          disabled={disabled || !prepared?.source.length}
          onClick={() => setReviewOwner(review ? null : identity)}
        >
          {t('assistant.summary.organize')}
        </Button>
        <Button
          size="sm"
          type="button"
          variant="outline"
          disabled={disabled || !messages.length}
          onClick={() => {
            setReviewOwner(null)
            useAssistantStore.getState().newTopic()
          }}
        >
          {t('assistant.context.newTopic')}
        </Button>
      </div>
      <p className="text-muted-foreground">
        {t('assistant.context.topicHint')}
      </p>
      {review && prepared && (
        <div className="space-y-2 rounded-md border border-(--pnds-border) p-3">
          <p>{t('assistant.summary.explain', { model: config?.model })}</p>
          <label htmlFor="assistant-summary-rounds">
            {t('assistant.summary.rounds')}
          </label>
          <Input
            id="assistant-summary-rounds"
            className="max-w-32"
            type="number"
            min={1}
            max={200}
            step={1}
            value={roundLimit}
            onChange={event => setRoundLimit(event.target.value)}
          />
          <p>
            {t('assistant.summary.range', {
              count: prepared.source.length,
              total: prepared.totalOlderRounds * 2,
            })}
          </p>
          <p>
            {currentEstimate
              ? t('assistant.summary.estimate', {
                  tokens:
                    currentEstimate.tokens ?? t('assistant.context.unknown'),
                  bytes: currentEstimate.bytes,
                })
              : t('assistant.summary.measuring')}
          </p>
          {currentEstimate?.exceeded && (
            <p role="alert" className="text-destructive">
              {t('assistant.summary.tooLarge')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              type="button"
              disabled={
                disabled ||
                !validLimit ||
                !prepared.source.length ||
                !currentEstimate ||
                currentEstimate.exceeded
              }
              onClick={() =>
                void useAssistantStore.getState().organizeContext(limit)
              }
            >
              {t('assistant.summary.call')}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => setReviewOwner(null)}
            >
              {t('close.cancel')}
            </Button>
          </div>
        </div>
      )}
      {organizing && <p role="status">{t('assistant.summary.generating')}</p>}
      {draft && (
        <div className="max-h-72 space-y-3 overflow-auto rounded-md border border-(--pnds-border) p-3">
          <p>{t('assistant.summary.review')}</p>
          <AssistantSummaryView sections={draft.sections} />
          {draft.usage && (
            <AssistantUsageStatistics usage={draft.usage} historical={false} />
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              size="sm"
              type="button"
              disabled={disabled}
              onClick={() => {
                useAssistantStore.getState().acceptSummary()
                setReviewOwner(null)
              }}
            >
              {t('assistant.summary.accept')}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="outline"
              disabled={disabled}
              onClick={() =>
                void useAssistantStore.getState().organizeContext(limit)
              }
            >
              {t('assistant.summary.redo')}
            </Button>
            <Button
              size="sm"
              type="button"
              variant="ghost"
              onClick={() => useAssistantStore.getState().discardSummary()}
            >
              {t('assistant.summary.discard')}
            </Button>
          </div>
        </div>
      )}
      {!draft && partial && (
        <details>
          <summary className="pnds-focus-ring">
            {t('assistant.summary.unaccepted')}
          </summary>
          <pre className="max-h-40 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]">
            {partial}
          </pre>
        </details>
      )}
    </div>
  )
}
