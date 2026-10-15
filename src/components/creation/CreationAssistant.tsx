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
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useSettingsStore } from '@/store/settings-store'
import { openHelpWindow } from '@/lib/help-window'
import { Button } from '@/components/ui/button'
import type { AssistantMessage } from '@/lib/assistant-types'
import { AssistantHistorySnapshots } from './AssistantHistorySnapshots'
import { AssistantHistoryControls } from './AssistantHistoryControls'
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
}: {
  identity: string
  renderMessageCards?: (message: AssistantMessage) => ReactNode
}) {
  const { t } = useTranslation()
  const input = useAssistantStore(state => state.input)
  const messages = useAssistantStore(state => state.messages)
  const phase = useAssistantStore(state => state.phase)
  const error = useAssistantStore(state => state.error)
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
    pausedReading?.identity === identity &&
    pausedReading.userMessage === userMessage
  const canSend =
    phase === 'idle' &&
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
    const ownerChanged = previous?.identity !== identity
    const targetedNavigation =
      returnMessageId &&
      (ownerChanged ||
        previous?.view !== view ||
        previous.target !== returnMessageId)
    previousNavigation.current = {
      identity,
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
    identity,
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
        followingLatest.current ? null : { identity, userMessage }
      )
    })
    observer.observe(panel)
    observer.observe(content)
    return () => {
      disposed = true
      observer.disconnect()
    }
  }, [identity, view, userMessage])

  return (
    <section
      aria-label={t('assistant.title')}
      className="creation-assistant flex min-h-0 flex-1 flex-col"
    >
      <AssistantHistoryControls identity={identity} />
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
            followingLatest.current ? null : { identity, userMessage }
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
              className="pnds-focus-ring mb-4 min-w-0 rounded-lg border border-(--pnds-border) p-3"
            >
              <p className="text-muted-foreground mb-2 text-xs">
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
              <AssistantHistorySnapshots message={message} />
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
                    {t('assistant.sourceCount', {
                      count: message.sources.length,
                    })}
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
                      <Button
                        key={`${source.locale}:${source.version ?? ''}:${source.docId}:${source.sectionId}:${source.format ?? ''}:${source.offset ?? ''}:${source.endOffset ?? ''}`}
                        size="sm"
                        variant="link"
                        className="h-auto max-w-full whitespace-normal px-0 text-start"
                        onClick={() =>
                          void openHelpWindow({
                            kind: 'doc',
                            docId: source.docId,
                            anchor: source.sectionId,
                            locale: source.locale,
                          })
                        }
                      >
                        <span>
                          {source.title}
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
        <div className="max-h-52 space-y-2 overflow-auto">
          <AssistantContextUsage identity={identity} />
          <AssistantContextControls identity={identity} />
        </div>
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
                (event.metaKey || event.ctrlKey) &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault()
                if (canSend) void useAssistantStore.getState().send()
              }
            }}
          />
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground text-xs">
              {t('assistant.sendHint')}
            </span>
            {phase === 'idle' ? (
              <Button size="sm" type="submit" disabled={!canSend}>
                {t(error ? 'assistant.retry' : 'assistant.send')}
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
