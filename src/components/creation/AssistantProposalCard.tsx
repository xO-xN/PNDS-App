import { useState, type ReactNode } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { useCreationStore } from '@/store/creation-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { openCreationFileAtLine } from '@/lib/creation-editor-navigation'
import type { TextBuffer } from '@/lib/text-buffer'
import { TextEditor } from './TextEditor'
import { useAssistantProjectStore } from '@/store/assistant-project-store'

export interface AssistantProposal {
  id: string
  messageId: string
  identity: string
  source: { path: string; version: string }
  candidate: { revision: number; text: string }
  preview: 'none' | 'temporary' | 'stale'
  pendingRefresh: boolean
  appliedDiff: { before: string; after: string } | null
}

/** Consumer-owned candidates stay separate from CreationFilesStore drafts.
 * #208/#231 supply binding, explicit apply and preview operations. */
export function AssistantProposalCard({
  proposal,
  parameters,
  buffer,
  onCodeChange,
  onApply,
  onPreview,
  busy = false,
}: {
  proposal: AssistantProposal
  parameters: ReactNode
  buffer: TextBuffer
  onCodeChange: (text: string) => void
  onApply?: () => void
  onPreview?: () => void
  busy?: boolean
}) {
  const { t } = useTranslation()
  const owner = useCreationStore(state => state.workspace?.project.identity)
  const [tab, setTab] = useState<'parameters' | 'code'>('parameters')
  const current = owner === proposal.identity
  return (
    <section
      aria-label={t('assistant.proposal.title')}
      className="my-3 min-w-0 rounded-md border border-(--pnds-border) p-3"
      data-proposal-id={proposal.id}
    >
      <p className="break-all text-xs">
        {t('assistant.proposal.source', proposal.source)}
      </p>
      <p className="text-muted-foreground mt-1 text-xs">
        {t('assistant.proposal.revision', {
          revision: proposal.candidate.revision,
        })}
      </p>
      {!current && (
        <p role="status" className="text-xs">
          {t('assistant.proposal.unavailable')}
        </p>
      )}
      <fieldset disabled={!current || busy} className="mt-3 min-w-0">
        <div className="mb-2 flex gap-2">
          {(['parameters', 'code'] as const).map(value => (
            <Button
              key={value}
              size="sm"
              variant="outline"
              aria-pressed={tab === value}
              onClick={() => setTab(value)}
            >
              {t(`assistant.proposal.${value}`)}
            </Button>
          ))}
        </div>
        <div hidden={tab !== 'parameters'}>{parameters}</div>
        <div hidden={tab !== 'code'} className="min-h-40 min-w-0">
          <TextEditor
            buffer={buffer}
            path={proposal.source.path}
            value={proposal.candidate.text}
            readOnly={!current || busy}
            onChange={onCodeChange}
            selectionAction={{
              label: t('assistant.attachment.add'),
              onSelect: () => {
                if (!current || busy) return
                void useAssistantProjectStore
                  .getState()
                  .attachSelection({
                    identity: proposal.identity,
                    path: proposal.source.path,
                    version: proposal.source.version,
                    source: 'proposal',
                    buffer,
                    proposalId: proposal.id,
                    candidateRevision: proposal.candidate.revision,
                  })
                  .then(added => {
                    if (
                      added &&
                      useCreationStore.getState().workspace?.project
                        .identity === proposal.identity
                    )
                      useCreationReadingStore.getState().showDiscussion()
                  })
              },
            }}
          />
        </div>
        <div className="mt-2 flex flex-wrap gap-2">
          {onPreview && (
            <Button size="sm" variant="outline" onClick={onPreview}>
              {t('assistant.proposal.preview')}
            </Button>
          )}
          {onApply && (
            <Button size="sm" onClick={onApply}>
              {t('assistant.proposal.apply')}
            </Button>
          )}
          <Button
            size="sm"
            variant="outline"
            onClick={() => {
              if (
                openCreationFileAtLine(
                  proposal.identity,
                  proposal.source.path,
                  1
                )
              )
                useCreationReadingStore.getState().showFile(proposal.messageId)
            }}
          >
            {t('assistant.proposal.openFile')}
          </Button>
        </div>
      </fieldset>
      {proposal.preview !== 'none' && (
        <p role="status" className="mt-2 text-xs">
          {t(`assistant.proposal.${proposal.preview}`)}
        </p>
      )}
      {proposal.pendingRefresh && (
        <p role="status" className="mt-2 text-xs">
          {t('assistant.proposal.pending')}
        </p>
      )}
      {proposal.appliedDiff && (
        <details className="mt-3">
          <summary className="pnds-focus-ring text-xs">
            {t('assistant.proposal.applied')}
          </summary>
          <div className="grid min-w-0 gap-2 text-xs">
            <pre
              aria-label={t('assistant.proposal.before')}
              className="overflow-auto whitespace-pre-wrap break-words"
            >
              {proposal.appliedDiff.before}
            </pre>
            <pre
              aria-label={t('assistant.proposal.after')}
              className="overflow-auto whitespace-pre-wrap break-words"
            >
              {proposal.appliedDiff.after}
            </pre>
          </div>
        </details>
      )}
    </section>
  )
}
