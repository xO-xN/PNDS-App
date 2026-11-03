import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { Copy } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'

/** Copy the parsed code value exactly, including its trailing whitespace. */
export function AssistantCodeBlock({
  code,
  language,
  streaming = false,
}: {
  code: string
  language?: string
  streaming?: boolean
}) {
  const { t } = useTranslation()
  return (
    <div className="assistant-code-block">
      <div className="assistant-code-block__header">
        <span className="assistant-code-block__language">
          {language || t('assistant.markdown.codeLabel')}
        </span>
        {streaming && (
          <span className="assistant-code-block__state">
            {t('assistant.markdown.generating')}
          </span>
        )}
        <Button
          type="button"
          size="sm"
          variant="ghost"
          onClick={() =>
            void writeText(code)
              .then(() => toast.success(t('assistant.markdown.codeCopied')))
              .catch(() => toast.error(t('toast.error.generic')))
          }
        >
          <Copy className="size-3.5" aria-hidden="true" />
          {t('assistant.markdown.copyCode')}
        </Button>
      </div>
      <pre
        className="assistant-code-block__content pnds-focus-ring"
        tabIndex={0}
        dir="ltr"
        aria-label={t('assistant.markdown.codeRegion')}
      >
        <code>{code}</code>
      </pre>
    </div>
  )
}
