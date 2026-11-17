import { useTranslation } from 'react-i18next'
import type { AssistantDeliveryEvidence } from '@/lib/assistant-delivery'
import { Button } from '@/components/ui/button'
import {
  useAssistantStore,
  verificationContinuationSource,
} from '@/store/assistant-store'
import { useCreationStore } from '@/store/creation-store'
import { useAssistantProjectStore } from '@/store/assistant-project-store'

/** Native/tool evidence remains visible independently of the model's wording. */
export function AssistantDeliveryStatus({
  evidence,
  messageId,
}: {
  evidence: AssistantDeliveryEvidence
  messageId?: string
}) {
  const { t } = useTranslation()
  const available = useAssistantStore(
    state => !!messageId && !!verificationContinuationSource(state, messageId)
  )
  const owner = useAssistantStore(state => state.owner)
  const ready = useAssistantStore(
    state =>
      state.phase === 'idle' &&
      state.configured &&
      !!state.modelConfig &&
      state.input.length === 0 &&
      state.historyState === 'ready' &&
      !state.historyBusy &&
      !state.historySaveError &&
      !state.activeQuestion &&
      !state.resourceApproval &&
      !state.editing &&
      !state.canContinue &&
      !state.paused &&
      !state.resumeRestored &&
      !state.organizing
  )
  const writable = useCreationStore(
    state =>
      !!owner &&
      state.workspace?.project.identity === owner &&
      state.workspace.project.source === 'folder'
  )
  const planning = useAssistantProjectStore(
    state => state.planning || !!state.whole
  )
  const stages = [
    ['staticCheck', evidence.staticCheck],
    ['build', evidence.build],
    ...(evidence.projectTests
      ? [['projectTests', evidence.projectTests] as const]
      : []),
    ['runtime', evidence.runtime],
    ['behavior', evidence.behavior],
  ] as const
  const visible = stages.filter(([, stage]) => stage.status !== 'notRequired')
  const incomplete = visible.some(([, stage]) => stage.status !== 'passed')
  return (
    <section
      className="my-3 space-y-2 border-s-2 border-(--pnds-border) ps-3 text-sm"
      aria-label={t('assistant.delivery.title')}
    >
      <p className="font-medium">
        {t(
          incomplete
            ? 'assistant.delivery.savedPending'
            : 'assistant.delivery.savedChecked'
        )}
      </p>
      <dl className="space-y-1 text-xs">
        {visible.map(([name, stage]) => (
          <div key={name}>
            <dt className="inline font-medium">
              {t(`assistant.delivery.stage.${name}`)}:{' '}
            </dt>
            <dd className="inline">
              {t(`assistant.delivery.status.${stage.status}`)}
              {stage.reason && (
                <span className="text-muted-foreground">
                  {' — '}
                  {t(`assistant.delivery.reason.${stage.reason}`, {
                    defaultValue: stage.reason,
                  })}
                </span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <details className="text-xs">
        <summary className="pnds-focus-ring cursor-pointer rounded-sm">
          {t('assistant.delivery.savedFiles', {
            count: evidence.savedPaths.length,
          })}
        </summary>
        <ul className="mt-1 list-inside list-disc">
          {evidence.savedPaths.map(path => (
            <li key={path} className="break-all">
              {path}
            </li>
          ))}
        </ul>
      </details>
      {available && messageId && (
        <Button
          size="sm"
          variant="outline"
          disabled={!ready || !writable || planning}
          onClick={() =>
            void useAssistantStore.getState().continueVerification(messageId)
          }
        >
          {t('assistant.delivery.continue')}
        </Button>
      )}
    </section>
  )
}
