import { useTranslation } from 'react-i18next'
import { useAssistantProjectStore } from '@/store/assistant-project-store'
import { useAssistantStore } from '@/store/assistant-store'
import {
  useCreationFilesStore,
  isDraftDirty,
} from '@/store/creation-files-store'
import { Button } from '@/components/ui/button'
import { conversationMessages } from '@/lib/assistant-conversations'

export function AssistantProjectControls({ identity }: { identity: string }) {
  const { t } = useTranslation()
  const config = useAssistantStore(state => state.modelConfig)
  const phase = useAssistantStore(state => state.phase)
  const waiting = useAssistantStore(state => !!state.resourceApproval)
  const planning = useAssistantProjectStore(state => state.planning)
  const drafts = useCreationFilesStore(state => state.drafts)
  const plan = async () => {
    const state = useAssistantStore.getState()
    const config = state.modelConfig
    if (!config || state.phase !== 'idle' || state.resourceApproval) return
    let history = conversationMessages(
      state.messages,
      state.activeConversationId
    )
    if (state.editing)
      history = history.slice(
        0,
        history.findIndex(message => message.id === state.editing?.messageId)
      )
    await useAssistantProjectStore
      .getState()
      .planWhole(identity, config, state.input, history)
    const current = useAssistantStore.getState()
    if (
      current.owner !== identity ||
      current.modelConfig !== config ||
      current.input !== state.input ||
      current.phase !== 'idle' ||
      current.resourceApproval
    )
      return
    if (
      await useAssistantProjectStore
        .getState()
        .confirmWhole(identity, config, state.input)
    )
      await useAssistantStore.getState().send(true)
  }
  return (
    <div className="space-y-2 border-t border-(--pnds-border) pt-3 text-xs">
      <Button
        type="button"
        size="sm"
        variant="ghost"
        disabled={!config || phase !== 'idle' || planning || waiting}
        onClick={() => void plan()}
      >
        {t(planning ? 'assistant.whole.preparing' : 'assistant.whole.action')}
      </Button>
      {Object.values(drafts).some(isDraftDirty) && (
        <p className="text-muted-foreground">
          {t('assistant.project.savedOnly')}
        </p>
      )}
    </div>
  )
}

export function AssistantProjectStatus() {
  const { t } = useTranslation()
  const whole = useAssistantProjectStore(state => state.whole)
  const planning = useAssistantProjectStore(state => state.planning)
  if (!planning && !whole?.error) return null
  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 text-xs">
      {planning && <p role="status">{t('assistant.whole.preparing')}</p>}
      {(planning || whole?.error) && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() => useAssistantProjectStore.getState().cancelWhole()}
        >
          {t('creation.cancel')}
        </Button>
      )}
      {whole?.error && (
        <p role="alert" className="text-destructive">
          {t(`assistant.error.${whole.error}`)}{' '}
          {t('assistant.whole.alternative')}
        </p>
      )}
    </div>
  )
}
