import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import {
  commands,
  type GitMergeChecks,
  type Result,
  type CreationError,
} from '@/lib/tauri-bindings'
import { useCreationMergeStore } from '@/store/creation-merge-store'
import { creationTransportError } from '@/store/creation-store'
import './creation-merge-checks.css'

function ok<T>(result: Result<T, CreationError>): T {
  if (result.status === 'error') throw result.error
  return result.data
}

export function CreationMergeChecks({
  identity,
  candidateId,
}: {
  identity: string
  candidateId: string
}) {
  const { t } = useTranslation()
  const candidate = useCreationMergeStore(state => state.candidate)
  const editing = useCreationMergeStore(state =>
    Object.values(state.drafts).some(draft => draft.text !== draft.savedText)
  )
  const working = useCreationMergeStore(state => state.busy)
  const [savedReport, setReport] = useState<GitMergeChecks | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revision = candidate?.revision
  useEffect(() => {
    let current = true
    if (revision == null) return
    void commands
      .getMergeCandidateChecks(identity, candidateId, revision)
      .then(result => {
        if (current) setReport(ok(result))
      })
      .catch(cause => {
        if (current) setError(creationTransportError(cause).detail)
      })
    return () => {
      current = false
    }
  }, [identity, candidateId, revision])
  const report = savedReport?.candidateId === candidateId ? savedReport : null
  if (!candidate || candidate.id !== candidateId) return null
  const owns = () =>
    useCreationMergeStore.getState().identity === identity &&
    useCreationMergeStore.getState().candidate?.id === candidateId
  const fresh =
    !!report?.fresh &&
    candidate.phase === 'active' &&
    report.revision === candidate.revision &&
    !editing
  const disabled =
    busy ||
    working ||
    candidate.phase !== 'active' ||
    !!candidate.assistantOwner
  const outcome = (value: string | undefined | null) =>
    !value ? 'notExecuted' : !fresh ? 'outdated' : value
  const staticStatus = outcome(
    report?.diagnostics
      ? report.diagnostics.staticPassed
        ? 'passed'
        : 'failed'
      : null
  )
  const compileStatus = outcome(report?.compileStatus)
  const testStatus = outcome(report?.tests?.status)
  async function run(kind: 'diagnose' | 'compile' | 'tests' | 'adopt') {
    if (disabled) return
    setBusy(true)
    setError(null)
    try {
      await useCreationMergeStore.getState().saveAll()
      if (!owns()) return
      if (kind === 'tests') await useCreationMergeStore.getState().validate()
      if (!owns()) return
      const value = useCreationMergeStore.getState().candidate
      if (!value || value.id !== candidateId) return
      if (kind === 'adopt') {
        ok(
          await commands.adoptMergeArtifacts(
            identity,
            candidateId,
            value.revision
          )
        )
        if (owns()) await useCreationMergeStore.getState().refresh()
        return
      }
      const request =
        kind === 'diagnose'
          ? commands.diagnoseMergeCandidate(
              identity,
              candidateId,
              value.revision
            )
          : kind === 'compile'
            ? commands.compileMergeCandidate(
                identity,
                candidateId,
                value.revision
              )
            : commands.runMergeCandidateTests(
                identity,
                candidateId,
                value.revision
              )
      const saved = ok(await request)
      if (owns()) setReport(saved)
    } catch (cause) {
      if (owns()) setError(creationTransportError(cause).detail)
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      className="creation-merge-checks"
      aria-label={t('creation.merge.checksTitle')}
      aria-busy={busy}
    >
      <header>
        <h2>{t('creation.merge.checksTitle')}</h2>
        <p>{t('creation.merge.checksHint')}</p>
      </header>
      <div className="creation-merge-check-row">
        <span>{t('creation.merge.staticCheck')}</span>
        <span role="status" data-outcome={staticStatus}>
          {t(`creation.merge.checkStatus.${staticStatus}`)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void run('diagnose')}
        >
          {t('creation.merge.runCheck')}
        </Button>
      </div>
      <div className="creation-merge-check-row">
        <span>{t('creation.merge.compile')}</span>
        <span role="status" data-outcome={compileStatus}>
          {t(`creation.merge.checkStatus.${compileStatus}`)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void run('compile')}
        >
          {t('creation.merge.compile')}
        </Button>
      </div>
      {candidate.relation === 'diverged' && report?.canAdopt && (
        <div className="creation-merge-check-adopt">
          <Button
            variant="ghost"
            size="sm"
            disabled={disabled || !fresh}
            onClick={() => void run('adopt')}
          >
            {t('creation.merge.adoptArtifacts')}
          </Button>
        </div>
      )}
      <div className="creation-merge-check-row">
        <span>{t('creation.merge.projectTests')}</span>
        <span role="status" data-outcome={testStatus}>
          {t(`creation.merge.checkStatus.${testStatus}`)}
        </span>
        <Button
          variant="ghost"
          size="sm"
          disabled={disabled}
          onClick={() => void run('tests')}
        >
          {t('creation.merge.runTests')}
        </Button>
      </div>
      {error && (
        <p role="alert" className="creation-merge-check-error">
          {error}
        </p>
      )}
      {report && (
        <details className="creation-merge-check-details">
          <summary>{t('creation.merge.checkDetails')}</summary>
          {report.diagnostics?.issues.map((issue, index) => (
            <p key={`${issue.code}:${index}`}>
              <code>{issue.path ?? issue.field ?? issue.code}</code> ·{' '}
              {issue.reason}
            </p>
          ))}
          {report.compile?.error && <p>{report.compile.error}</p>}
          {report.compile?.output && <pre>{report.compile.output}</pre>}
          {report.tests?.error && <p>{report.tests.error}</p>}
          {!!report.tests?.outputTail.length && (
            <pre>{report.tests.outputTail.join('\n')}</pre>
          )}
          {report.detail && <p>{report.detail}</p>}
        </details>
      )}
    </section>
  )
}
