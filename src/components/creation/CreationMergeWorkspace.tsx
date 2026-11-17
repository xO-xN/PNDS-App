import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowLeft, Pencil } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import type { GitVersionGraph } from '@/lib/tauri-bindings'
import { useCreationMergeStore } from '@/store/creation-merge-store'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { useSessionStore } from '@/store/session-store'
import { useMergeAssistantStore } from '@/store/merge-assistant-store'
import { CreationGitGraph } from './CreationGitGraph'
import { CreationGitHubSync } from './CreationGitHubSync'
import { CreationErrorNotice } from './CreationErrorNotice'
import { CreationMergeEditor } from './CreationMergeEditor'
import './creation-merge.css'

export function CreationMergeContext() {
  const { t } = useTranslation()
  const identity = useCreationMergeStore(state => state.identity)
  const candidate = useCreationMergeStore(state => state.candidate)
  const busy = useCreationMergeStore(state => state.busy)
  const error = useCreationMergeStore(state => state.error)
  const canCancel =
    candidate && !['publishing', 'recovery'].includes(candidate.phase)
  if (!candidate || !identity) return null
  return (
    <>
      <header className="creation-version-toolbar creation-merge-context">
        {canCancel ? (
          <Button
            size="sm"
            variant="ghost"
            disabled={busy}
            title={t('creation.merge.exitHint')}
            onClick={() => {
              void useCreationMergeStore
                .getState()
                .cancel()
                .then(() => useCreationReadingStore.getState().showGit())
                .catch(() => undefined)
            }}
          >
            <ArrowLeft aria-hidden="true" />
            {t('creation.merge.returnHistory')}
          </Button>
        ) : (
          <span>{t('creation.merge.result')}</span>
        )}
        <span className="creation-merge-context-state">
          {t(`creation.merge.phase.${candidate.phase}`)}
        </span>
        <CreationGitHubSync
          identity={identity}
          active
          head={candidate.target}
          branch={candidate.branch}
          localBusy={busy}
          readOnly
          updateBlock="task"
          beginUpdate={() => false}
          endUpdate={() => undefined}
          onUpdated={async () => false}
          onTemplateBackupFinished={() => undefined}
        />
      </header>
      {error && <CreationErrorNotice error={error} />}
    </>
  )
}

function MergeName() {
  const { t } = useTranslation()
  const candidate = useCreationMergeStore(state => state.candidate)
  const busy = useCreationMergeStore(state => state.busy)
  const [draft, setDraft] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const finishing = useRef(false)
  if (!candidate) return null
  const editable =
    candidate.phase === 'active' &&
    candidate.relation === 'diverged' &&
    !candidate.assistantOwner
  const submit = async () => {
    if (finishing.current || draft === null) return
    const name = draft.trim()
    if (!name || name === candidate.name) {
      setDraft(null)
      return
    }
    finishing.current = true
    setSaving(true)
    try {
      await useCreationMergeStore.getState().rename(name)
      setDraft(null)
    } catch {
      /* Keep the rejected name available to correct. */
    } finally {
      finishing.current = false
      setSaving(false)
    }
  }
  return (
    <div className="creation-merge-name">
      {draft === null ? (
        <>
          <strong title={candidate.name}>{candidate.name}</strong>
          {editable && (
            <button
              type="button"
              className="creation-version-rename pnds-focus-ring"
              aria-label={t('creation.merge.rename')}
              disabled={busy}
              onClick={() => setDraft(candidate.name)}
            >
              <Pencil aria-hidden="true" />
            </button>
          )}
        </>
      ) : (
        <Input
          autoFocus
          value={draft}
          maxLength={120}
          disabled={saving || busy || !editable}
          aria-label={t('creation.versions.versionName')}
          onFocus={event => event.currentTarget.select()}
          onChange={event => setDraft(event.target.value)}
          onBlur={() => void submit()}
          onKeyDown={event => {
            if (event.nativeEvent.isComposing) return
            if (event.key === 'Escape' && !saving) {
              event.preventDefault()
              setDraft(null)
            }
            if (event.key === 'Enter') {
              event.preventDefault()
              void submit()
            }
          }}
        />
      )}
    </div>
  )
}

export function CreationMergeWorkspace({
  graph,
  loading,
  onMore,
}: {
  graph: GitVersionGraph | null
  loading: boolean
  onMore: () => void
}) {
  const { t } = useTranslation()
  const candidate = useCreationMergeStore(state => state.candidate)
  const drafts = useCreationMergeStore(state => state.drafts)
  const busy = useCreationMergeStore(state => state.busy)
  const inspection = useCreationMergeStore(state => state.inspection)
  const optionalApproval = useCreationMergeStore(
    state => state.optionalApproval
  )
  const runtime = useSessionStore(state => state.sessionStatus)
  const assistantPending = useMergeAssistantStore(
    state => state.phase !== 'idle'
  )
  const scroll = useRef<HTMLDivElement>(null)
  if (!candidate) return null
  const source = graph?.versions.find(item => item.id === candidate.source)
  const target = graph?.versions.find(item => item.id === candidate.target)
  const pending = candidate.files.filter(
    file => file.conflict && !file.resolved
  )
  const pendingChoices = pending.some(
    file =>
      file.conflict !== 'text' ||
      !drafts[file.path] ||
      drafts[file.path]?.text === drafts[file.path]?.savedText
  )
  const status =
    candidate.phase !== 'active'
      ? `creation.merge.phase.${candidate.phase}`
      : candidate.assistantOwner
        ? 'creation.merge.assistantOwns'
        : pending.length
          ? 'creation.merge.pending'
          : 'creation.merge.ready'
  const primary =
    candidate.phase === 'recovery'
      ? 'recover'
      : candidate.phase === 'stale'
        ? 'reprepare'
        : candidate.phase === 'paused'
          ? 'resume'
          : 'finish'
  const primaryAction = () => {
    const state = useCreationMergeStore.getState()
    const task =
      primary === 'recover'
        ? state.finish()
        : primary === 'reprepare'
          ? state.reprepare()
          : primary === 'resume'
            ? state.resume()
            : state.finish()
    void task.catch(() => undefined)
  }
  return (
    <div className="creation-merge-workspace">
      <div className="creation-version-overview">
        <CreationGitGraph
          graph={graph}
          selected={inspection?.commit ?? candidate.source}
          working={false}
          loading={loading}
          busy={false}
          onMore={onMore}
          scrollRef={scroll}
          onChoose={commit => {
            const version = graph?.versions.find(item => item.id === commit)
            if (!version) return
            useCreationMergeStore.getState().inspect({
              commit,
              label: version.message.split('\n')[0] ?? version.id,
              side:
                commit === candidate.source
                  ? 'incoming'
                  : commit === candidate.target
                    ? 'current'
                    : commit === candidate.base
                      ? 'base'
                      : null,
            })
          }}
        />
        <aside
          className="creation-merge-actions"
          aria-label={t('creation.merge.result')}
        >
          <MergeName />
          <p
            className="creation-merge-direction"
            title={`${source?.message ?? candidate.source} → ${target?.message ?? candidate.target}`}
          >
            {(source?.message ?? candidate.source).split('\n')[0]} →{' '}
            {(target?.message ?? candidate.target).split('\n')[0]}
          </p>
          <p
            className={
              pending.length || candidate.phase !== 'active'
                ? 'creation-merge-conflict'
                : ''
            }
            role="status"
          >
            {t(status, { count: pending.length })}
          </p>
          <Button
            size="sm"
            disabled={
              busy ||
              assistantPending ||
              ['starting', 'stopping'].includes(runtime) ||
              candidate.phase === 'publishing' ||
              !!candidate.assistantOwner ||
              (candidate.phase === 'active' && pendingChoices)
            }
            onClick={primaryAction}
          >
            {t(
              `creation.merge.${primary === 'finish' && optionalApproval ? 'finishAnyway' : primary === 'finish' && runtime === 'ready' ? 'stopAndFinish' : primary}`
            )}
          </Button>
          {candidate.phase === 'active' && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() =>
                useCreationReadingStore.getState().showDiscussion()
              }
            >
              {t('creation.merge.assistantAction')}
            </Button>
          )}
        </aside>
      </div>
      {(optionalApproval || candidate.detail) && (
        <div className="creation-version-notice">
          <div>
            {optionalApproval && (
              <p className="creation-merge-conflict">
                {t('creation.merge.optionalWarning')}
              </p>
            )}
            {candidate.detail && <p>{candidate.detail}</p>}
          </div>
        </div>
      )}
      <CreationMergeEditor />
    </div>
  )
}
