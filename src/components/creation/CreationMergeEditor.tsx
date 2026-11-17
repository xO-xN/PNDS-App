import { lazy, Suspense, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  commands,
  type GitComparisonDiff,
  type GitMergeContent,
  type CreationError,
} from '@/lib/tauri-bindings'
import { creationTransportError } from '@/store/creation-store'
import { useCreationMergeStore } from '@/store/creation-merge-store'
import { useMergeAssistantStore } from '@/store/merge-assistant-store'
import { CreationGitDifference } from './CreationGitDifference'
import { CreationMergeMedia } from './CreationMergeMedia'
import { CreationErrorNotice } from './CreationErrorNotice'

const MergeCodeEditor = lazy(() => import('./CreationMergeCodeEditor'))

export function CreationMergeEditor() {
  const { t } = useTranslation()
  const identity = useCreationMergeStore(state => state.identity)
  const candidate = useCreationMergeStore(state => state.candidate)
  const path = useCreationMergeStore(state => state.selectedPath)
  const view = useCreationMergeStore(state => state.view)
  const inspection = useCreationMergeStore(state => state.inspection)
  const busy = useCreationMergeStore(state => state.busy)
  const assistantPending = useMergeAssistantStore(
    state => state.phase !== 'idle'
  )
  const result = useCreationMergeStore(state =>
    path ? state.contents[`result:${path}`] : undefined
  )
  const draft = useCreationMergeStore(state =>
    path ? state.drafts[path] : undefined
  )
  const current = useCreationMergeStore(state =>
    path ? state.contents[`current:${path}`] : undefined
  )
  const incoming = useCreationMergeStore(state =>
    path ? state.contents[`incoming:${path}`] : undefined
  )
  const base = useCreationMergeStore(state =>
    path ? state.contents[`base:${path}`] : undefined
  )
  const [sources, setSources] = useState(false)
  const candidateId = candidate?.id
  const candidateRevision = candidate?.revision
  const readKey = JSON.stringify([
    identity,
    candidateId,
    candidateRevision,
    path,
    view,
    inspection,
  ])
  const [readState, setReadState] = useState<{
    key: string
    diff: GitComparisonDiff | null
    snapshot: GitMergeContent | null
    error: CreationError | null
  } | null>(null)
  const loaded = readState?.key === readKey ? readState : null
  const diff = loaded?.diff ?? null
  const snapshot = loaded?.snapshot ?? null
  const readError = loaded?.error ?? null
  const loading = !!(
    identity &&
    candidateId &&
    path &&
    (inspection || view === 'diff') &&
    !loaded
  )
  const file = candidate?.files.find(file => file.path === path)
  const locked =
    busy ||
    assistantPending ||
    candidate?.phase !== 'active' ||
    candidate?.relation === 'fastForward' ||
    !!candidate?.assistantOwner ||
    !!inspection
  useEffect(() => {
    if (!path || !candidateId) return
    void useCreationMergeStore.getState().read(path, 'result')
    if (sources)
      for (const side of ['base', 'current', 'incoming'] as const)
        void useCreationMergeStore.getState().read(path, side)
  }, [path, candidateId, candidateRevision, sources])
  useEffect(() => {
    let active = true
    if (
      !identity ||
      !candidateId ||
      candidateRevision == null ||
      !path ||
      (!inspection && view !== 'diff')
    )
      return
    const read = async () => {
      if (inspection?.side)
        return {
          snapshot: await useCreationMergeStore
            .getState()
            .read(path, inspection.side),
        }
      if (inspection) {
        const value = await commands.readCreationGitVersionFile(
          identity,
          inspection.commit,
          path
        )
        if (value.status === 'error') throw value.error
        return { history: value.data }
      }
      const value = await commands.readCreationGitMergeDiff(
        identity,
        candidateId,
        candidateRevision,
        path,
        false
      )
      if (value.status === 'error') throw value.error
      return { diff: value.data }
    }
    void read()
      .then(value => {
        if (!active) return
        let snapshot: GitMergeContent | null =
          'snapshot' in value ? (value.snapshot ?? null) : null
        if ('history' in value && value.history) {
          const history = value.history
          snapshot = {
            path,
            side: 'result',
            exists: history.reason == null,
            version: history.diskVersion ?? '',
            text: history.historicalText ?? null,
            url: null,
            size: history.historicalSize,
            mime: 'text/plain',
            durationMs: null,
            sampleRate: null,
            channels: null,
            waveform: null,
          }
        }
        setReadState({
          key: readKey,
          diff: 'diff' in value ? (value.diff ?? null) : null,
          snapshot,
          error: null,
        })
      })
      .catch(error => {
        if (active)
          setReadState({
            key: readKey,
            diff: null,
            snapshot: null,
            error: creationTransportError(error),
          })
      })
    return () => {
      active = false
    }
  }, [
    identity,
    candidateId,
    candidateRevision,
    path,
    view,
    inspection,
    readKey,
  ])
  if (!candidate) return null
  if (!file || !path)
    return (
      <p className="creation-version-empty">{t('creation.merge.noChanges')}</p>
    )
  const text = file.kind === 'text'
  const toggleView = async () => {
    if (view === 'edit') {
      try {
        await useCreationMergeStore.getState().saveAll()
      } catch {
        return
      }
    }
    useCreationMergeStore.getState().setView(view === 'edit' ? 'diff' : 'edit')
  }
  return (
    <section
      className="creation-merge-editor"
      aria-label={t('creation.merge.result')}
      onKeyDownCapture={event => {
        if ((event.metaKey || event.ctrlKey) && event.code === 'KeyS') {
          event.preventDefault()
          event.stopPropagation()
          if (!locked)
            void useCreationMergeStore
              .getState()
              .saveAll()
              .catch(() => undefined)
        }
      }}
    >
      <header className="creation-merge-editor-head">
        <strong title={path}>{path}</strong>
        <span className="flex-1" />
        {inspection ? (
          <Button
            size="sm"
            variant="ghost"
            onClick={() => useCreationMergeStore.getState().inspect(null)}
          >
            {t('creation.merge.returnResult')}
          </Button>
        ) : (
          text && (
            <Button
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => void toggleView()}
            >
              {t(
                view === 'edit'
                  ? 'creation.merge.viewDiff'
                  : 'creation.merge.editResult'
              )}
            </Button>
          )
        )}
        <span
          className={
            file.conflict && !file.resolved ? 'creation-merge-conflict' : ''
          }
        >
          {t(
            file.conflict && !file.resolved
              ? 'creation.merge.conflict'
              : 'creation.merge.result'
          )}
        </span>
      </header>
      {readError && <CreationErrorNotice error={readError} />}
      {inspection ? (
        <div className="creation-merge-snapshot">
          {loading ? (
            <p role="status">{t('creation.loading')}</p>
          ) : snapshot?.exists ? (
            snapshot.text != null ? (
              <pre>{snapshot.text}</pre>
            ) : snapshot.url ? (
              <img src={snapshot.url} alt={path} />
            ) : (
              <p>{t('creation.merge.binary')}</p>
            )
          ) : (
            <p>{t('creation.merge.missingFile')}</p>
          )}
          <p>{t('creation.merge.inspecting', { version: inspection.label })}</p>
        </div>
      ) : !text ? (
        <CreationMergeMedia path={path} locked={locked} />
      ) : view === 'diff' ? (
        <CreationGitDifference
          diff={diff}
          path={path}
          loading={loading}
          fullContext={false}
          onFullContext={() => undefined}
          onOpen={() => undefined}
          canOpen={false}
        />
      ) : (
        <>
          <details
            className="creation-merge-sources"
            open={sources}
            onToggle={event => setSources(event.currentTarget.open)}
          >
            <summary>{t('creation.merge.viewSources')}</summary>
            <div>
              {(
                [
                  ['base', base],
                  ['current', current],
                  ['incoming', incoming],
                ] as const
              ).map(([side, content]) => (
                <section key={side}>
                  <strong>{t(`creation.merge.${side}`)}</strong>
                  <pre>
                    {content?.exists
                      ? (content.text ?? t('creation.merge.binary'))
                      : t('creation.merge.missingFile')}
                  </pre>
                </section>
              ))}
            </div>
          </details>
          {file.conflict && !file.resolved && (
            <div className="creation-merge-text-choices">
              <Button
                size="sm"
                variant="ghost"
                disabled={locked}
                onClick={() =>
                  void useCreationMergeStore
                    .getState()
                    .choose(path, 'current')
                    .catch(() => undefined)
                }
              >
                {t('creation.merge.keepCurrent')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={locked}
                onClick={() =>
                  void useCreationMergeStore
                    .getState()
                    .choose(path, 'incoming')
                    .catch(() => undefined)
                }
              >
                {t('creation.merge.useIncoming')}
              </Button>
            </div>
          )}
          {result?.exists === false && !draft ? (
            <div className="creation-version-empty">
              {t('creation.merge.deleted')}
            </div>
          ) : draft ? (
            <Suspense fallback={<p role="status">{t('creation.loading')}</p>}>
              <MergeCodeEditor path={path} readOnly={locked} />
            </Suspense>
          ) : (
            <p role="status">{t('creation.loading')}</p>
          )}
        </>
      )}
      {candidate.relation === 'fastForward' && (
        <p className="creation-merge-footnote">
          {t('creation.merge.fastHint')}
        </p>
      )}
    </section>
  )
}
