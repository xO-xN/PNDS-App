import { useTranslation } from 'react-i18next'
import type { AssistantMessage } from '@/lib/assistant-types'

/** Captured text is inert: no current-file reads, candidate editor or execution callbacks. */
export function AssistantHistorySnapshots({
  message,
}: {
  message: AssistantMessage
}) {
  const { t } = useTranslation()
  return (
    <>
      {message.attachments?.map(attachment => (
        <section
          key={attachment.id}
          className="mt-3 rounded border border-(--pnds-border) p-2 text-xs"
        >
          <p>{t(`assistant.history.source.${attachment.source}`)}</p>
          <p>
            {t('assistant.history.attachmentLocation', {
              path: attachment.path,
              start: attachment.startLine,
              end: attachment.endLine,
            })}
          </p>
          <p>
            {t('assistant.history.version', { version: attachment.version })}
            {attachment.candidateRevision != null &&
              ` · ${t('assistant.proposal.revision', { revision: attachment.candidateRevision })}`}
          </p>
          <p className="text-muted-foreground mt-1">
            {t('assistant.history.attachmentNote')}
          </p>
          <pre
            tabIndex={0}
            className="pnds-focus-ring mt-2 max-h-64 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
            dir="ltr"
          >
            {attachment.text}
          </pre>
        </section>
      ))}
      {message.proposals?.map(proposal => (
        <section
          key={proposal.id}
          className="mt-3 rounded border border-(--pnds-border) p-2 text-xs"
        >
          <p>
            {t('assistant.history.proposalLocation', {
              path: proposal.path,
              version: proposal.sourceVersion,
              revision: proposal.candidateRevision,
            })}
          </p>
          <p className="text-muted-foreground mt-1">
            {t('assistant.history.proposalNote')}
          </p>
          {proposal.pendingRefresh && (
            <p>{t('assistant.history.pendingRefresh')}</p>
          )}
          <pre
            tabIndex={0}
            className="pnds-focus-ring mt-2 max-h-64 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
            dir="ltr"
          >
            {proposal.text}
          </pre>
          {proposal.appliedDiff && (
            <details className="mt-2">
              <summary className="pnds-focus-ring">
                {t('assistant.proposal.applied')}
              </summary>
              <pre
                tabIndex={0}
                aria-label={t('assistant.proposal.before')}
                className="pnds-focus-ring mt-2 max-h-64 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
                dir="ltr"
              >
                {proposal.appliedDiff.before}
              </pre>
              <pre
                tabIndex={0}
                aria-label={t('assistant.proposal.after')}
                className="pnds-focus-ring mt-2 max-h-64 overflow-auto whitespace-pre-wrap [overflow-wrap:anywhere]"
                dir="ltr"
              >
                {proposal.appliedDiff.after}
              </pre>
            </details>
          )}
        </section>
      ))}
    </>
  )
}
