import { useTranslation } from 'react-i18next'
import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useAssistantHandoffStore } from '@/store/assistant-handoff-store'
import { prepareAssistantHandoff } from '@/lib/assistant-handoff'

export function AssistantHandoffCard({ messageId }: { messageId: string }) {
  const { t } = useTranslation()
  const item = useAssistantHandoffStore(state => state.items[messageId])
  const [busy, setBusy] = useState(false)
  if (!item) return null
  const { suggestion, identity } = item
  return (
    <section
      className="my-3 space-y-2 rounded border border-(--pnds-border) p-3 text-sm"
      aria-label={t('assistant.handoff.title')}
    >
      <h3 className="font-semibold">{t('assistant.handoff.title')}</h3>
      <p>{suggestion.reason}</p>
      <p>{suggestion.intent}</p>
      <p className="break-all">{suggestion.files.join(', ')}</p>
      <p>
        {t('assistant.handoff.knownProblems')}: {suggestion.knownProblems}
      </p>
      <p>{suggestion.acceptance}</p>
      <p>{t('assistant.handoff.ask')}</p>
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() => {
            setBusy(true)
            void prepareAssistantHandoff(
              identity,
              suggestion.intent,
              suggestion.files,
              `${t('assistant.handoff.knownProblems')}: ${suggestion.knownProblems}\n\n${suggestion.acceptance}`
            )
              .then(prepared => {
                if (prepared) {
                  useAssistantHandoffStore.getState().dismiss(messageId)
                  useCreationReadingStore.getState().showDiscussion(messageId)
                }
              })
              .finally(() => setBusy(false))
          }}
        >
          {t('assistant.handoff.review')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={busy}
          onClick={() => useAssistantHandoffStore.getState().dismiss(messageId)}
        >
          {t('assistant.handoff.decline')}
        </Button>
      </div>
    </section>
  )
}
