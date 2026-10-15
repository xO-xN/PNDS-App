import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  commands,
  type AssistantRoundUsage,
  type ContextMeasurement,
} from '@/lib/tauri-bindings'
import { buildAssistantMessages } from '@/lib/assistant-flow'
import { useAssistantStore } from '@/store/assistant-store'

export function AssistantContextUsage({ identity }: { identity: string }) {
  const { t } = useTranslation()
  const input = useAssistantStore(state => state.input)
  const messages = useAssistantStore(state => state.messages)
  const config = useAssistantStore(state => state.modelConfig)
  const phase = useAssistantStore(state => state.phase)
  const live = useAssistantStore(state => state.contextMeasurement)
  const historyState = useAssistantStore(state => state.historyState)
  const [preview, setPreview] = useState<{
    input: string
    messages: typeof messages
    config: typeof config
    measurement: ContextMeasurement | null
  } | null>(null)
  useEffect(() => {
    if (!config || phase !== 'idle' || historyState !== 'ready') return
    let stale = false
    const timer = setTimeout(() => {
      void commands
        .measureAssistantContext(
          config,
          buildAssistantMessages(messages, input, {
            owner: identity,
            config,
            projectReading: false,
          })
        )
        .then(result => {
          if (!stale && useAssistantStore.getState().owner === identity)
            setPreview({
              input,
              messages,
              config,
              measurement: result.status === 'ok' ? result.data : null,
            })
        })
        .catch(() => {
          if (!stale) setPreview({ input, messages, config, measurement: null })
        })
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [config, identity, input, messages, phase, historyState])
  const measurement =
    phase !== 'idle'
      ? live
      : preview?.input === input &&
          preview.messages === messages &&
          preview.config === config
        ? preview.measurement
        : null
  if (!config)
    return (
      <p className="text-muted-foreground text-xs">
        {t('assistant.context.unavailable')}
      </p>
    )
  return (
    <details className="rounded-md border border-(--pnds-border) p-2 text-xs">
      <summary className="pnds-focus-ring">
        {t(
          phase === 'idle'
            ? 'assistant.context.next'
            : 'assistant.context.current'
        )}
        :{' '}
        {measurement?.estimatedTokens == null
          ? t('assistant.context.tokensUnknown')
          : t('assistant.context.estimated', {
              count: measurement.estimatedTokens,
            })}
      </summary>
      <div className="mt-2 max-h-48 space-y-2 overflow-auto [overflow-wrap:anywhere]">
        <p>
          {t('assistant.context.capacity', {
            value: measurement?.capacity ?? t('assistant.context.unknown'),
          })}{' '}
          · {t('assistant.context.unverified')}
        </p>
        <p>
          {t('assistant.context.inputBudget', {
            value:
              measurement?.effectiveInput ?? t('assistant.context.unknown'),
          })}{' '}
          ·{' '}
          {t('assistant.context.reserve', {
            value:
              measurement?.outputReserve ??
              (config.context?.maxOutput ?? 4096) +
                (config.context?.reasoningReserve ?? 0),
          })}
        </p>
        <p>
          {t('assistant.context.method', {
            method: t(
              `assistant.context.encoder.${measurement?.tokenizer ?? config.context?.tokenizer ?? 'unknown'}`
            ),
          })}
        </p>
        {measurement && (
          <>
            <p>
              {t('assistant.context.units', {
                characters: measurement.characters,
                bytes: measurement.utf8Bytes,
              })}
            </p>
            {measurement.parts.map(part => (
              <p key={part.kind}>
                {t(`assistant.context.part.${part.kind}`)}:{' '}
                {part.estimatedTokens === null
                  ? t('assistant.context.tokensUnknown')
                  : t('assistant.context.estimated', {
                      count: part.estimatedTokens,
                    })}{' '}
                ·{' '}
                {t('assistant.context.units', {
                  characters: part.characters,
                  bytes: part.utf8Bytes,
                })}
              </p>
            ))}
            {measurement.exceeded && (
              <p role="alert" className="text-destructive">
                {t(
                  measurement.exceeded === 'contextBytes'
                    ? 'assistant.error.contextBytesExceeded'
                    : 'assistant.error.contextTokensExceeded'
                )}
              </p>
            )}
          </>
        )}
        <p className="text-muted-foreground">
          {t('assistant.context.framing')}
        </p>
      </div>
    </details>
  )
}

export function AssistantUsageStatistics({
  usage,
  historical,
}: {
  usage: AssistantRoundUsage
  historical: boolean
}) {
  const { t } = useTranslation()
  const known = usage.calls.filter(call => call !== null)
  const inputs = known.flatMap(call =>
    call.inputTokens === null ? [] : [call.inputTokens]
  )
  const outputs = known.flatMap(call =>
    call.outputTokens === null ? [] : [call.outputTokens]
  )
  const input = inputs.length
    ? inputs.reduce((sum, value) => sum + value, 0)
    : t('assistant.context.unknown')
  const output = outputs.length
    ? outputs.reduce((sum, value) => sum + value, 0)
    : t('assistant.context.unknown')
  return (
    <details className="mt-2 text-xs text-muted-foreground">
      <summary className="pnds-focus-ring">
        {t(historical ? 'assistant.usage.historical' : 'assistant.usage.title')}{' '}
        ·{' '}
        {t(
          usage.complete
            ? 'assistant.usage.complete'
            : 'assistant.usage.incomplete'
        )}
      </summary>
      <p className="mt-2">
        {known.length
          ? t('assistant.usage.subtotal', {
              input,
              output,
              count: usage.calls.length,
            })
          : t('assistant.usage.unknown')}
      </p>
      <ol className="mt-1 space-y-1">
        {usage.calls.map((call, index) => (
          <li key={index}>
            {t('assistant.usage.call', {
              number: index + 1,
              input: call?.inputTokens ?? t('assistant.context.unknown'),
              output: call?.outputTokens ?? t('assistant.context.unknown'),
            })}
            {call?.cachedInputTokens != null && (
              <>
                {' '}
                ·{' '}
                {t('assistant.usage.cached', { count: call.cachedInputTokens })}
              </>
            )}
            {call?.reasoningTokens != null && (
              <>
                {' '}
                ·{' '}
                {t('assistant.usage.reasoning', {
                  count: call.reasoningTokens,
                })}
              </>
            )}
          </li>
        ))}
      </ol>
      <p>{t('assistant.usage.explanation')}</p>
      {usage.documentMetrics && (
        <p>{t('assistant.usage.documents', { ...usage.documentMetrics })}</p>
      )}
    </details>
  )
}
