import { useTranslation } from 'react-i18next'
import { confirm } from '@tauri-apps/plugin-dialog'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectTrigger,
  SelectValue,
  SelectContent,
  SelectItem,
} from '@/components/ui/select'
import {
  useAssistantProposalStore,
  type LiveProposal,
} from '@/store/assistant-proposal-store'
import { useParameterPreviewStore } from '@/store/parameter-preview-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { AssistantProposalCard } from './AssistantProposalCard'
import { CreationErrorNotice } from './CreationErrorNotice'
import { TextDifference } from './CreationFileChangeControls'
import type { BoundParameter } from '@/lib/tauri-bindings'
import { prepareAssistantHandoff } from '@/lib/assistant-handoff'

function ParameterControl({
  proposal,
  parameter,
}: {
  proposal: LiveProposal
  parameter: BoundParameter
}) {
  const { t } = useTranslation()
  const { spec, suggestedMin, suggestedMax } = parameter.request
  const value = parameter.value
  const disabled = value === null || proposal.applying || proposal.bindingBusy
  const change = (next: number | string | boolean) =>
    void useAssistantProposalStore
      .getState()
      .setParameter(proposal.id, spec.id, next)
  const label = `${proposal.id}-${spec.id}`
  const controlClass =
    'pnds-focus-ring min-w-0 rounded border border-(--pnds-border) bg-(--pnds-pill) px-2 py-1 text-sm'
  return (
    <fieldset
      disabled={disabled}
      className="min-w-0 space-y-2 rounded border border-(--pnds-border) p-2"
    >
      <legend className="px-1 text-xs font-semibold">{spec.id}</legend>
      <label htmlFor={label} className="sr-only">
        {spec.id}
      </label>
      {spec.kind === 'boolean' ? (
        <input
          id={label}
          className="pnds-focus-ring"
          type="checkbox"
          checked={value === true}
          onChange={event => change(event.target.checked)}
        />
      ) : spec.kind === 'option' ? (
        <Select
          disabled={disabled}
          value={typeof value === 'string' ? JSON.stringify(value) : ''}
          onValueChange={encoded => {
            const option = (spec.limits.options ?? []).find(
              option => JSON.stringify(option) === encoded
            )
            if (option !== undefined) change(option)
          }}
        >
          <SelectTrigger id={label}>
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {(spec.limits.options ?? []).map(option => (
              <SelectItem key={option} value={JSON.stringify(option)}>
                {option || t('assistant.proposal.emptyOption')}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      ) : (
        <input
          id={label}
          className={controlClass}
          type={
            spec.kind === 'number'
              ? 'number'
              : spec.kind === 'color'
                ? 'color'
                : 'text'
          }
          value={
            typeof value === 'number' || typeof value === 'string' ? value : ''
          }
          min={spec.limits.min ?? undefined}
          max={spec.limits.max ?? undefined}
          step={spec.limits.step ?? 'any'}
          maxLength={spec.limits.maxLength ?? 4096}
          onChange={event => {
            if (spec.kind === 'number') {
              if (event.target.value !== '') change(Number(event.target.value))
            } else change(event.target.value)
          }}
        />
      )}
      {spec.kind === 'number' &&
        (spec.limits.min ?? suggestedMin) != null &&
        (spec.limits.max ?? suggestedMax) != null && (
          <input
            className="pnds-focus-ring block w-full"
            aria-label={t('assistant.proposal.fader', { id: spec.id })}
            type="range"
            min={spec.limits.min ?? suggestedMin ?? undefined}
            max={spec.limits.max ?? suggestedMax ?? undefined}
            step={spec.limits.step ?? 'any'}
            value={typeof value === 'number' ? value : 0}
            onChange={event => change(Number(event.target.value))}
          />
        )}
      <p className="break-all text-xs text-muted-foreground">
        {t('assistant.proposal.hardLimits', {
          limits: JSON.stringify(spec.limits),
        })}
      </p>
      {(suggestedMin != null || suggestedMax != null) && (
        <p className="text-xs text-muted-foreground">
          {t('assistant.proposal.suggestedRange', {
            min: suggestedMin ?? '…',
            max: suggestedMax ?? '…',
          })}
        </p>
      )}
      <p className="text-xs">
        {t(`assistant.proposal.capability.${spec.preview}`)}
      </p>
      {disabled && !proposal.applying && (
        <p role="status" className="text-xs">
          {t('assistant.proposal.bindingUnavailable')}
        </p>
      )}
      <Button
        size="sm"
        variant="ghost"
        onClick={() => {
          const line = proposal.recommended
            .split(/\r?\n/)
            .find(
              line => line.startsWith(spec.prefix) && line.endsWith(spec.suffix)
            )
          if (!line) return
          try {
            const original: unknown = JSON.parse(
              line.slice(spec.prefix.length, -spec.suffix.length)
            )
            if (
              typeof original === 'number' ||
              typeof original === 'string' ||
              typeof original === 'boolean'
            )
              change(original)
          } catch {
            /* The original may deliberately be code-only. */
          }
        }}
      >
        {t('assistant.proposal.restoreParameter')}
      </Button>
    </fieldset>
  )
}

function LiveCard({ proposal }: { proposal: LiveProposal }) {
  const { t } = useTranslation()
  const preview = useParameterPreviewStore(state =>
    state.owner?.proposalId === proposal.id ? state : null
  )
  const lastChange = useCreationFilesStore(state => state.lastChange)
  const changeBusy = useCreationFilesStore(state => state.changeBusy)
  const changeError = useCreationFilesStore(state => state.changeError)
  return (
    <div>
      <AssistantProposalCard
        proposal={{
          ...proposal,
          appliedDiff: null,
          preview: preview?.status === 'temporary' ? 'temporary' : 'none',
        }}
        buffer={proposal.buffer}
        busy={proposal.applying}
        parameters={
          <div className="space-y-2">
            {proposal.binding?.parameters.length ? (
              proposal.binding.parameters.map(parameter => (
                <ParameterControl
                  key={parameter.request.spec.id}
                  proposal={proposal}
                  parameter={parameter}
                />
              ))
            ) : (
              <p className="text-xs">
                {t('assistant.proposal.bindingUnavailable')}
              </p>
            )}
          </div>
        }
        onCodeChange={text =>
          useAssistantProposalStore.getState().editCode(proposal.id, text)
        }
        onApply={() =>
          void useAssistantProposalStore.getState().apply(proposal.id)
        }
        onPreview={() =>
          void useAssistantProposalStore.getState().preview(proposal.id)
        }
      />
      <p className="text-xs text-muted-foreground">
        {t('assistant.proposal.scope')}
      </p>
      <div className="my-2 flex flex-wrap gap-2">
        <Button
          size="sm"
          variant="outline"
          onClick={() =>
            void prepareAssistantHandoff(
              proposal.identity,
              t('assistant.proposal.handoffIntent', {
                path: proposal.source.path,
              }),
              [proposal.source.path],
              t('assistant.check.handoffAcceptance', { task: '—' })
            )
          }
        >
          {t('assistant.proposal.handoff')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={proposal.applying}
          onClick={() => void useParameterPreviewStore.getState().end()}
        >
          {t('assistant.proposal.endPreview')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={proposal.applying}
          onClick={() =>
            void confirm(t('assistant.proposal.discardCandidate'), {
              title: t('assistant.proposal.reloadSource'),
              kind: 'warning',
            })
              .then(approved => {
                if (approved)
                  void useAssistantProposalStore.getState().reload(proposal.id)
              })
              .catch(() => toast.error(t('toast.error.generic')))
          }
        >
          {t('assistant.proposal.reloadSource')}
        </Button>
        <Button
          size="sm"
          variant="outline"
          disabled={proposal.applying}
          onClick={() =>
            void confirm(t('assistant.proposal.discardCandidate'), {
              title: t('assistant.proposal.restoreSuggestion'),
              kind: 'warning',
            })
              .then(approved => {
                if (approved)
                  useAssistantProposalStore
                    .getState()
                    .editCode(proposal.id, proposal.recommended)
              })
              .catch(() => toast.error(t('toast.error.generic')))
          }
        >
          {t('assistant.proposal.restoreSuggestion')}
        </Button>
      </div>
      {proposal.error && <CreationErrorNotice error={proposal.error} />}
      {preview && (
        <div role="status" aria-live="polite" className="space-y-1 text-xs">
          <p>{t(`assistant.proposal.previewState.${preview.status}`)}</p>
          {preview.problem && (
            <p>{t(`assistant.proposal.previewProblem.${preview.problem}`)}</p>
          )}
          {preview.status === 'unrestored' && (
            <p>{t('assistant.proposal.manualRecovery')}</p>
          )}
          {(preview.partial || preview.unpreviewed.length > 0) && (
            <p>
              {t('assistant.proposal.partial', {
                ids: preview.unpreviewed.join(', '),
              })}
            </p>
          )}
          {preview.status === 'temporary' && (
            <p>
              {t('assistant.proposal.observed', {
                values: JSON.stringify(preview.feedback),
              })}
            </p>
          )}
        </div>
      )}
      {proposal.records.map(record => (
        <details key={record.id} className="my-3 text-xs">
          <summary className="pnds-focus-ring">
            {t('assistant.proposal.applied')} · {record.path} ·{' '}
            {record.beforeVersion} → {record.afterVersion}
          </summary>
          <TextDifference before={record.beforeText} after={record.afterText} />
          <Button
            size="sm"
            variant="outline"
            disabled={changeBusy || lastChange?.id !== record.id}
            onClick={() =>
              void useCreationFilesStore
                .getState()
                .undoChange(proposal.identity, record.id)
            }
          >
            {t('creation.change.undo')}
          </Button>
          {lastChange?.id === record.id && changeError && (
            <CreationErrorNotice error={changeError} />
          )}
        </details>
      ))}
    </div>
  )
}

export function AssistantLiveProposals({ messageId }: { messageId: string }) {
  const items = useAssistantProposalStore(state => state.items)
  return (
    <>
      {Object.values(items)
        .filter(proposal => proposal.messageId === messageId)
        .map(proposal => (
          <LiveCard key={proposal.id} proposal={proposal} />
        ))}
    </>
  )
}
