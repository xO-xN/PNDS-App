import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useAssistantStore } from '@/store/assistant-store'
import { useAssistantHandoffStore } from '@/store/assistant-handoff-store'
import { useCreationStore } from '@/store/creation-store'
import { conversationMessages } from '@/lib/assistant-conversations'
import { modelProfileKey } from '@/lib/model-context-settings'

/** A displayed plan is reference data. Only the explicit action creates a new task. */
export function AssistantWorkflowCard({ messageId }: { messageId: string }) {
  const { t } = useTranslation()
  const item = useAssistantHandoffStore(state => state.items[messageId])
  const current = useAssistantStore(state => {
    const message = conversationMessages(
      state.messages,
      state.activeConversationId
    ).at(-1)
    return (
      message?.id === messageId &&
      message.status === 'completed' &&
      !!state.modelConfig &&
      message.contextServiceKey === modelProfileKey(state.modelConfig) &&
      !state.historicalMessageIds.includes(messageId) &&
      state.owner === item?.identity
    )
  })
  const ready = useAssistantStore(
    state =>
      state.phase === 'idle' &&
      state.configured &&
      state.historyState === 'ready' &&
      !state.historyBusy &&
      state.historySaveError !== 'staleHistory' &&
      !state.activeQuestion &&
      !state.resourceApproval &&
      !state.editing &&
      !state.canContinue &&
      !state.paused &&
      !state.resumeRestored &&
      !state.organizing
  )
  const mode = useAssistantStore(state => state.mode)
  const writable = useCreationStore(
    state =>
      state.workspace?.project.identity === item?.identity &&
      state.workspace?.project.source === 'folder'
  )
  if (!item || !current) return null
  const { suggestion } = item
  return (
    <section
      className="my-3 space-y-2 text-sm"
      aria-label={t('assistant.workflow.title')}
    >
      <div className="space-y-1 border-s-2 border-(--pnds-border) ps-3">
        <p>
          <strong>{t('assistant.workflow.goal')}: </strong>
          {suggestion.intent}
        </p>
        <p>
          <strong>{t('assistant.workflow.scope')}: </strong>
          {suggestion.files.join(', ')}
        </p>
        <p>
          <strong>{t('assistant.workflow.acceptance')}: </strong>
          {suggestion.acceptance}
        </p>
        {suggestion.knownProblems && (
          <p className="text-muted-foreground">{suggestion.knownProblems}</p>
        )}
      </div>
      <p>{t('assistant.workflow.choose')}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || !writable || mode !== 'discussion'}
          onClick={() => void useAssistantStore.getState().prepareHandoff()}
        >
          {t('assistant.workflow.handoff')}
        </Button>
        <Button
          size="sm"
          disabled={!ready || !writable}
          onClick={() => void useAssistantStore.getState().startWork(messageId)}
        >
          {t('assistant.workflow.start')}
        </Button>
      </div>
    </section>
  )
}
