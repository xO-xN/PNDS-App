import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/** A saved text snapshot. Copying grants no App write or task authority. */
export function AssistantHandoffPrompt({ prompt }: { prompt: string }) {
  const { t } = useTranslation()
  return (
    <section
      className="creation-action-card my-3 rounded-lg border border-(--pnds-border) bg-(--pnds-pill) p-3"
      aria-label={t('assistant.handoff.promptTitle')}
    >
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm font-medium">
          {t('assistant.handoff.promptTitle')}
        </p>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            void writeText(prompt)
              .then(() => toast.success(t('creation.handoff.copied')))
              .catch(() => toast.error(t('toast.error.generic')))
          }
        >
          <Copy className="size-3.5" aria-hidden="true" />
          {t('assistant.handoff.copyPrompt')}
        </Button>
      </div>
      <p className="whitespace-pre-wrap break-words text-xs leading-relaxed text-muted-foreground">
        {prompt}
      </p>
    </section>
  )
}
