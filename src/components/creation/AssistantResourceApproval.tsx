import { useTranslation } from 'react-i18next'
import { PackagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { resourceName } from '@/lib/assistant-resources'
import { useAssistantStore } from '@/store/assistant-store'

export function AssistantResourceApproval({ replyId }: { replyId: string }) {
  const { t } = useTranslation()
  const approval = useAssistantStore(state => state.resourceApproval)
  const busy = useAssistantStore(state => state.resourceApprovalBusy)
  if (!approval || approval.replyId !== replyId) return null
  const { plan } = approval
  return (
    <section
      aria-label={t('assistant.resources.title')}
      className="creation-action-card my-3 space-y-3 rounded-lg border border-(--pnds-border) bg-(--pnds-pill) p-4 text-sm"
    >
      <div className="flex items-center gap-2 font-medium">
        <PackagePlus className="size-4 shrink-0" aria-hidden="true" />
        {t('assistant.resources.title')}
      </div>
      <p className="whitespace-pre-wrap break-words">{plan.reason}</p>
      <ul className="space-y-2">
        {plan.resources.map(resource => (
          <li key={`${resource.kind}:${resource.id}`}>
            <div className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium">{resourceName(resource)}</span>
              <span className="text-xs text-muted-foreground">
                {t(`assistant.resources.${resource.kind}`)} · {resource.version}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">
              {t(`assistant.resources.${resource.kind}Impact`, {
                id: resource.id,
              })}
            </p>
          </li>
        ))}
      </ul>
      <p className="text-xs text-muted-foreground">
        {t('assistant.resources.waiting')}
      </p>
      {plan.alternative && (
        <p className="whitespace-pre-wrap break-words text-xs">
          {t('assistant.resources.alternativeDescription', {
            description: plan.alternative,
          })}
        </p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button
          size="sm"
          disabled={busy}
          onClick={() =>
            void useAssistantStore.getState().decideResourceApproval('approved')
          }
        >
          {t('assistant.resources.approve')}
        </Button>
        {plan.alternative && (
          <Button
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() =>
              void useAssistantStore
                .getState()
                .decideResourceApproval('alternative')
            }
          >
            {t('assistant.resources.alternative')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          disabled={busy}
          onClick={() => useAssistantStore.getState().stop()}
        >
          {t('assistant.resources.cancel')}
        </Button>
      </div>
    </section>
  )
}
