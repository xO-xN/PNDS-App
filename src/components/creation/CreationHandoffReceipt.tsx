import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { handoffLanguage, handoffPrompt } from '@/lib/assistant-handoff-prompt'
import { cn } from '@/lib/utils'
import { useAssistantStore } from '@/store/assistant-store'
import { useCreationHandoffStore } from '@/store/creation-handoff-store'
import { useCreationStore } from '@/store/creation-store'
import { CreationErrorNotice } from './CreationErrorNotice'

/** Durable outcome details belong to the handoff surface, not shared navigation. */
export function CreationHandoffReceipt({ className }: { className?: string }) {
  const { t } = useTranslation()
  const receipt = useCreationHandoffStore(state => state.receipt)
  const recorded = useCreationHandoffStore(state => state.recorded)
  const project = useCreationStore(state => state.workspace?.project)
  const taskRecorded = receipt?.taskRecorded ?? recorded
  if (!taskRecorded && !receipt?.baselineError) return null
  return (
    <div className={cn('space-y-2 text-start text-xs', className)}>
      {taskRecorded && (
        <div className="flex flex-wrap items-start gap-2">
          <details className="min-w-0 flex-1 text-xs">
            <summary className="pnds-focus-ring">
              <span role="status">
                {t(
                  receipt?.baselineId && !receipt.baselineError
                    ? 'creation.handoff.summaryWithBaseline'
                    : 'creation.handoff.summary'
                )}
              </span>
            </summary>
            <div className="mt-2 space-y-2">
              <p>{t('creation.handoff.recorded')}</p>
              {receipt?.baselineId && !receipt.baselineError && (
                <p>{t('creation.handoff.baselineReady')}</p>
              )}
              {receipt && (
                <p className="break-all">
                  {t('creation.handoff.revision', {
                    id: receipt.task.id,
                    revision: receipt.revision,
                  })}
                </p>
              )}
            </div>
          </details>
          {receipt?.taskRecorded && (
            <Button
              size="sm"
              variant="outline"
              disabled={!project}
              onClick={() => {
                if (
                  !project ||
                  useCreationStore.getState().workspace?.project.identity !==
                    project.identity
                )
                  return
                const assistant = useAssistantStore.getState()
                const savedPrompt =
                  assistant.owner === project.identity
                    ? assistant.messages.find(
                        message =>
                          message.handoff?.taskId === receipt.task.id &&
                          message.handoff.revision === receipt.revision
                      )?.handoff?.prompt
                    : undefined
                const language = handoffLanguage(
                  savedPrompt
                    ? []
                    : [{ role: 'user', text: receipt.task.intent }],
                  savedPrompt
                )
                void writeText(handoffPrompt(project.root, language))
                  .then(() => toast.success(t('creation.handoff.copied')))
                  .catch(() => toast.error(t('toast.error.generic')))
              }}
            >
              {t('creation.handoff.copy')}
            </Button>
          )}
        </div>
      )}
      {receipt?.baselineError && (
        <div role="alert">
          {t(
            receipt.taskRecorded
              ? 'creation.handoff.baselineFailed'
              : 'creation.handoff.taskFailed'
          )}
          <CreationErrorNotice error={receipt.baselineError} />
        </div>
      )}
    </div>
  )
}
