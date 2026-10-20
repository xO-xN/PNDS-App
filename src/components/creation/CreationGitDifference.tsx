import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ArrowDown, ArrowUp } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { GitComparisonDiff, GitComparisonLine } from '@/lib/tauri-bindings'
import { splitGitLines } from '@/lib/creation-git-difference'

export function CreationGitDifference({
  diff,
  path,
  loading,
  fullContext,
  onFullContext,
  onOpen,
  canOpen,
}: {
  diff: GitComparisonDiff | null
  path: string | null
  loading: boolean
  fullContext: boolean
  onFullContext: () => void
  onOpen: () => void
  canOpen: boolean
}) {
  const { t } = useTranslation()
  const [split, setSplit] = useState(false)
  const [hunk, setHunk] = useState(0)
  const [observedFile, setObservedFile] = useState('')
  const fileKey = `${diff?.token}:${path}:${fullContext}`
  if (observedFile !== fileKey) {
    setObservedFile(fileKey)
    setHunk(0)
  }
  const table = useRef<HTMLTableElement>(null)
  const code = (line: GitComparisonLine | null) =>
    line && (
      <>
        {line.content}
        {line.noNewline && (
          <span className="creation-git-no-newline">
            {t('creation.comparison.noNewline')}
          </span>
        )}
      </>
    )
  const sign = (line: GitComparisonLine | null) =>
    line?.kind === 'addition' ? '+' : line?.kind === 'deletion' ? '−' : ''
  const navigate = (step: number) => {
    const next = Math.max(
      0,
      Math.min((diff?.hunks.length ?? 1) - 1, hunk + step)
    )
    setHunk(next)
    table.current
      ?.querySelector(`[data-hunk="${next}"]`)
      ?.scrollIntoView({ block: 'nearest' })
  }
  return (
    <section
      className="creation-git-difference"
      aria-label={t('creation.versions.differences')}
    >
      <header>
        <strong title={path ?? ''}>
          {path ?? t('creation.comparison.chooseFile')}
        </strong>
        {diff && (
          <span className="creation-git-stat">
            <ins>+{diff.added}</ins>
            <del>−{diff.deleted}</del>
          </span>
        )}
        <span className="flex-1" />
        <div
          className="creation-git-file-filter"
          aria-label={t('creation.comparison.layout')}
        >
          <button
            type="button"
            aria-pressed={!split}
            onClick={() => setSplit(false)}
          >
            {t('creation.comparison.unified')}
          </button>
          <button
            type="button"
            aria-pressed={split}
            onClick={() => setSplit(true)}
          >
            {t('creation.comparison.split')}
          </button>
        </div>
        <Button
          size="sm"
          variant="ghost"
          disabled={!path || loading}
          aria-pressed={fullContext}
          onClick={onFullContext}
        >
          {t(
            fullContext
              ? 'creation.comparison.collapseContext'
              : 'creation.comparison.expandContext'
          )}
        </Button>
        <Button size="sm" variant="ghost" disabled={!canOpen} onClick={onOpen}>
          {t('creation.comparison.openCurrent')}
        </Button>
      </header>
      {diff && diff.hunks.length > 0 && (
        <nav aria-label={t('creation.comparison.hunks')}>
          <span>{t('creation.comparison.directionLines')}</span>
          <span className="flex-1" />
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('creation.comparison.previous')}
            disabled={hunk <= 0}
            onClick={() => navigate(-1)}
          >
            <ArrowUp aria-hidden="true" />
          </Button>
          <span>
            {Math.min(hunk + 1, diff.hunks.length)} / {diff.hunks.length}
          </span>
          <Button
            size="icon"
            variant="ghost"
            aria-label={t('creation.comparison.next')}
            disabled={hunk >= diff.hunks.length - 1}
            onClick={() => navigate(1)}
          >
            <ArrowDown aria-hidden="true" />
          </Button>
        </nav>
      )}
      <div
        className="creation-git-diff-scroll"
        tabIndex={0}
        aria-busy={loading}
      >
        {loading ? (
          <p role="status">{t('creation.git.loading')}</p>
        ) : !path ? (
          <p>{t('creation.comparison.chooseFile')}</p>
        ) : !diff ? (
          <p>{t('creation.comparison.unavailable')}</p>
        ) : diff?.reason ? (
          <p>{t(`creation.history.reason.${diff.reason}`)}</p>
        ) : diff && !diff.hunks.length ? (
          <p>{t('creation.comparison.noTextChanges')}</p>
        ) : (
          diff && (
            <table
              ref={table}
              className={split ? 'split' : 'unified'}
              aria-label={t('creation.comparison.code')}
            >
              <thead>
                <tr>
                  {split ? (
                    <>
                      <th colSpan={3}>{t('creation.comparison.before')}</th>
                      <th colSpan={3}>{t('creation.comparison.after')}</th>
                    </>
                  ) : (
                    <>
                      <th>{t('creation.comparison.before')}</th>
                      <th>{t('creation.comparison.after')}</th>
                      <th aria-label={t('creation.comparison.statusLabel')} />
                      <th>{t('creation.comparison.code')}</th>
                    </>
                  )}
                </tr>
              </thead>
              {diff.hunks.map((part, index) => (
                <tbody key={index}>
                  <tr className="creation-git-hunk" data-hunk={index}>
                    <td colSpan={split ? 6 : 4}>
                      @@ −{part.oldStart},{part.oldLines} +{part.newStart},
                      {part.newLines} @@
                    </td>
                  </tr>
                  {split
                    ? splitGitLines(part.lines).map((row, rowIndex) => (
                        <tr key={rowIndex}>
                          <td
                            className="line-number"
                            data-change={row.before?.kind}
                          >
                            {row.before?.oldLine}
                          </td>
                          <td
                            className="line-sign"
                            data-change={row.before?.kind}
                          >
                            {sign(row.before)}
                          </td>
                          <td
                            className="line-code"
                            data-change={row.before?.kind}
                          >
                            {code(row.before)}
                          </td>
                          <td
                            className="line-number"
                            data-change={row.after?.kind}
                          >
                            {row.after?.newLine}
                          </td>
                          <td
                            className="line-sign"
                            data-change={row.after?.kind}
                          >
                            {sign(row.after)}
                          </td>
                          <td
                            className="line-code"
                            data-change={row.after?.kind}
                          >
                            {code(row.after)}
                          </td>
                        </tr>
                      ))
                    : part.lines.map((line, lineIndex) => (
                        <tr key={lineIndex} data-change={line.kind}>
                          <td className="line-number">{line.oldLine}</td>
                          <td className="line-number">{line.newLine}</td>
                          <td className="line-sign">{sign(line)}</td>
                          <td className="line-code">{code(line)}</td>
                        </tr>
                      ))}
                </tbody>
              ))}
            </table>
          )
        )}
      </div>
    </section>
  )
}
