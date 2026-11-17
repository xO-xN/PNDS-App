import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { openHelpWindow } from '@/lib/help-window'
import { assistantSourceKey } from '@/lib/assistant-project'
import { groupDocumentSources } from '@/lib/assistant-source-groups'
import type { AssistantSource } from '@/lib/assistant-types'

export function AssistantDocumentSources({
  sources,
}: {
  sources: readonly AssistantSource[]
}) {
  const { t } = useTranslation()
  return groupDocumentSources(sources).map(document => (
    <section key={document.key} aria-label={document.title} className="w-full">
      {document.sections.length > 1 && (
        <p className="mt-1 font-medium">{document.title}</p>
      )}
      {document.sections.map(ranges => {
        const source = ranges[0]
        if (!source) return null
        return (
          <div key={source.sectionId}>
            <Button
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
              {source.title}
            </Button>
            <details className="text-xs text-muted-foreground">
              <summary className="pnds-focus-ring">
                {t('assistant.sourceRanges', { count: ranges.length })}
              </summary>
              <p>{t('assistant.sourceVersionNote')}</p>
              {ranges.map(range => (
                <p key={assistantSourceKey(range)}>
                  {range.offset != null && range.endOffset != null
                    ? t('assistant.sourceRange', {
                        offset: range.offset,
                        end: range.endOffset,
                        total: range.totalCharacters,
                        format: t(
                          `assistant.sourceFormat.${range.format ?? 'unknown'}`
                        ),
                        version: range.version,
                      })
                    : t('assistant.sourceRangeUnknown')}
                </p>
              ))}
            </details>
          </div>
        )
      })}
    </section>
  ))
}
