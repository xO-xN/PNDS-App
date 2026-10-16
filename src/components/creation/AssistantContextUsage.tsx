import { useEffect, useState, type ReactNode } from 'react'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { conversationMessages } from '@/lib/assistant-conversations'
import { useTranslation } from 'react-i18next'
import {
  commands,
  type AssistantRoundUsage,
  type ContextMeasurement,
} from '@/lib/tauri-bindings'
import { buildAssistantMessages } from '@/lib/assistant-flow'
import { useAssistantStore } from '@/store/assistant-store'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import { modelConfigurationKey } from '@/lib/model-context-settings'
import { useAssistantOverviewStore } from '@/store/assistant-overview-store'

export function AssistantContextUsage({
  identity,
  children,
}: {
  identity: string
  children?: ReactNode
}) {
  const { t, i18n } = useTranslation()
  const input = useAssistantStore(state => state.input)
  const messages = useAssistantStore(state => state.messages)
  const active = useAssistantStore(state => state.activeConversationId)
  const editing = useAssistantStore(state => state.editing)
  const config = useAssistantStore(state => state.modelConfig)
  const phase = useAssistantStore(state => state.phase)
  const live = useAssistantStore(state => state.contextMeasurement)
  const historyState = useAssistantStore(state => state.historyState)
  const reading = useAssistantProjectStore(state => state.reading)
  const project = useAssistantProjectStore(state => state.snapshot)
  const authorization = useAssistantProjectStore(state => state.authorization)
  const attachments = useAssistantProjectStore(state => state.attachments)
  const overview = useAssistantOverviewStore(state => state.overview)
  const overviewStale = useAssistantOverviewStore(state => state.stale)
  const staticEvidence = useAssistantOverviewStore(
    state => state.staticEvidence
  )
  const testEvidence = useAssistantOverviewStore(state => state.testEvidence)
  const contextKey = JSON.stringify([
    overview?.snapshot.fingerprint,
    overviewStale,
    staticEvidence,
    testEvidence,
  ])
  const [preview, setPreview] = useState<{
    input: string
    messages: typeof messages
    config: typeof config
    active: typeof active
    editing: typeof editing
    project: typeof project
    attachments: typeof attachments
    authorization: typeof authorization
    reading: boolean
    contextKey: string
    measurement: ContextMeasurement | null
  } | null>(null)
  useEffect(() => {
    if (!config || phase !== 'idle' || historyState !== 'ready') return
    const currentProject = overview?.snapshot ?? project
    const authorized =
      reading &&
      authorization?.owner === identity &&
      authorization.service === modelConfigurationKey(config) &&
      !!currentProject &&
      !currentProject.files.some(
        file => !file.reason && !authorization.paths.includes(file.path)
      )
    if (authorized && overviewStale) return
    let stale = false
    let history = conversationMessages(messages, active)
    if (editing)
      history = history.slice(
        0,
        history.findIndex(message => message.id === editing.messageId)
      )
    const timer = setTimeout(() => {
      const consumer = authorized
        ? useAssistantOverviewStore
            .getState()
            .contextConsumer(
              identity,
              config,
              i18n.resolvedLanguage === 'zh-CN' ? 'zh-CN' : 'en'
            )
        : null
      void commands
        .measureAssistantContext(
          config,
          buildAssistantMessages(history, input, {
            owner: identity,
            config,
            projectReading: authorized,
            project: currentProject ?? undefined,
            consumers: consumer ? [consumer] : [],
            attachments: attachments.map(item => item.snapshot),
          })
        )
        .then(result => {
          if (!stale && useAssistantStore.getState().owner === identity)
            setPreview({
              input,
              messages,
              config,
              active,
              editing,
              project,
              attachments,
              authorization,
              reading,
              contextKey,
              measurement: result.status === 'ok' ? result.data : null,
            })
        })
        .catch(() => {
          if (!stale)
            setPreview({
              input,
              messages,
              config,
              active,
              editing,
              project,
              attachments,
              authorization,
              reading,
              contextKey,
              measurement: null,
            })
        })
    }, 150)
    return () => {
      stale = true
      clearTimeout(timer)
    }
  }, [
    config,
    identity,
    input,
    messages,
    active,
    editing,
    phase,
    historyState,
    project,
    reading,
    authorization,
    attachments,
    contextKey,
    overview,
    overviewStale,
    i18n.resolvedLanguage,
  ])
  const measurement =
    phase !== 'idle'
      ? live
      : preview?.input === input &&
          preview.messages === messages &&
          preview.config === config &&
          preview.active === active &&
          preview.editing === editing &&
          preview.project === project &&
          preview.attachments === attachments &&
          preview.authorization === authorization &&
          preview.reading === reading &&
          preview.contextKey === contextKey
        ? preview.measurement
        : null
  const tokens =
    measurement?.estimatedTokens ?? measurement?.referenceEstimatedTokens
  const capacity = measurement?.capacity ?? config?.context?.capacity
  const percent = tokens != null && capacity ? (tokens / capacity) * 100 : null
  const number = new Intl.NumberFormat(i18n.resolvedLanguage, {
    maximumFractionDigits: 1,
  })
  const percentText =
    percent !== null && percent > 0 && percent < 0.1
      ? `<${number.format(0.1)}`
      : number.format(percent ?? 0)
  const status =
    percent === null
      ? t(
          tokens != null && !capacity
            ? 'assistant.chat.contextCapacityUnknown'
            : 'assistant.chat.contextUnknown'
        )
      : t('assistant.chat.contextEstimatedPercent', { value: percentText })
  let color: string | undefined
  if (percent !== null) {
    if (percent <= 20) color = 'var(--pnds-context-low)'
    else if (percent === 60) color = 'var(--pnds-context-mid)'
    else if (percent >= 100) color = 'var(--pnds-context-high)'
    else {
      const lower = percent < 60 ? 'low' : 'mid'
      const upper = percent < 60 ? 'mid' : 'high'
      const weight = (1 - (percent - (percent < 60 ? 20 : 60)) / 40) * 100
      color = `color-mix(in srgb, var(--pnds-context-${lower}) ${weight}%, var(--pnds-context-${upper}))`
    }
  }
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="pnds-focus-ring inline-flex h-8 shrink-0 items-center justify-center gap-1.5 rounded-md px-1 text-muted-foreground hover:text-foreground"
          style={{ color }}
          aria-label={t('assistant.chat.contextStatus', { value: status })}
          title={t('assistant.chat.contextStatus', { value: status })}
        >
          <svg
            aria-hidden="true"
            viewBox="0 0 24 24"
            className="size-5 -rotate-90 fill-none"
            strokeWidth="3"
          >
            <circle
              cx="12"
              cy="12"
              r="9"
              stroke="currentColor"
              opacity="0.25"
              className="text-muted-foreground"
            />
            {percent !== null && (
              <circle
                cx="12"
                cy="12"
                r="9"
                stroke="currentColor"
                pathLength="100"
                strokeDasharray={`${Math.min(100, Math.max(0, percent))} 100`}
              />
            )}
          </svg>
          <span className="text-xs tabular-nums">
            {percent === null ? t('assistant.chat.contextTitle') : status}
          </span>
        </button>
      </PopoverTrigger>
      <PopoverContent
        side="top"
        align="start"
        className="max-h-[70vh] w-80 max-w-[calc(100vw-2rem)] space-y-3 overflow-auto text-sm"
      >
        <p className="font-medium">{t('assistant.chat.contextTitle')}</p>
        <p className="text-lg tabular-nums">
          {percent === null ? (
            <span className="block text-sm">{status}</span>
          ) : (
            `${status} · `
          )}
          {t('assistant.chat.contextFraction', {
            used: tokens?.toLocaleString() ?? '—',
            capacity: capacity?.toLocaleString() ?? '—',
          })}
        </p>
        <p className="text-xs text-muted-foreground">
          {config
            ? t(
                measurement?.estimatedTokens == null &&
                  measurement?.referenceEstimatedTokens != null
                  ? 'assistant.chat.contextReferenceEstimate'
                  : 'assistant.chat.contextEstimate'
              )
            : t('assistant.context.unavailable')}
        </p>
        {percent !== null && !measurement?.exceeded && (
          <p className="text-xs">
            {t(
              percent <= 20
                ? 'assistant.chat.contextSmartZone'
                : percent <= 60
                  ? 'assistant.chat.contextGrowing'
                  : 'assistant.chat.contextHigh'
            )}
          </p>
        )}
        {measurement?.exceeded && (
          <p role="alert" className="text-xs text-destructive">
            {t(
              measurement.exceeded === 'contextBytes'
                ? 'assistant.error.contextBytesExceeded'
                : 'assistant.error.contextTokensExceeded'
            )}
          </p>
        )}
        {children}
      </PopoverContent>
    </Popover>
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
