import { TooltipHint } from '@/components/ui/tooltip'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FileCode, Folder } from 'lucide-react'
import { SearchField } from '@/components/ui/search-field'
import {
  creationFileTree,
  creationProjectFileRole,
} from '@/lib/creation-file-tree'
import { CreationFileLabel } from './CreationFileLabel'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import './creation-version-files.css'

/** Historical paths are comparison entries, never writable workspace files. */
export function CreationGitFiles({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const comparison = useCreationReadingStore(state => state.gitComparison)
  const phase = useCreationReadingStore(state => state.gitComparisonPhase)
  const selected = useCreationReadingStore(state => state.gitPath)
  const mode = useCreationReadingStore(state => state.gitComparisonMode)
  const working = useCreationReadingStore(state => state.gitComparisonWorking)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const files = comparison?.files ?? []
  const changed = files.filter(file => file.status !== 'unchanged')
  const rows = creationFileTree(
    changed.map(file => ({
      path: file.path,
      size: 0,
      kind: 'text' as const,
      category: 'system' as const,
    })),
    [],
    collapsed,
    search
  )
  return (
    <section className="creation-git-files creation-version-files">
      <header>
        <h2>{t('creation.comparison.changedFiles')}</h2>
        <span
          title={t('creation.comparison.changedCount', {
            count: changed.length,
          })}
        >
          {changed.length}
        </span>
      </header>
      {!working && (
        <div
          className="creation-version-comparison"
          role="group"
          aria-label={t('creation.comparison.compare')}
        >
          {(['parent', 'saved'] as const).map(value => (
            <button
              key={value}
              type="button"
              className="pnds-focus-ring"
              aria-pressed={mode === value}
              disabled={disabled}
              title={t(
                value === 'parent'
                  ? 'creation.comparison.parentToSelected'
                  : 'creation.comparison.diskHint'
              )}
              onClick={() =>
                useCreationReadingStore.getState().setGitComparisonMode(value)
              }
            >
              {t(
                value === 'parent'
                  ? 'creation.comparison.versionChanges'
                  : 'creation.comparison.withLocal'
              )}
            </button>
          ))}
        </div>
      )}
      <div className="creation-version-file-search">
        <SearchField
          variant="secondary"
          size="sm"
          aria-label={t('creation.comparison.search')}
          placeholder={t('creation.comparison.search')}
          value={search}
          onValueChange={setSearch}
        />
      </div>
      <div
        className="creation-git-file-list"
        aria-label={t('creation.comparison.files')}
      >
        {!comparison ? (
          <p role="status">
            {t(
              phase === 'loading'
                ? 'creation.git.loading'
                : phase === 'error'
                  ? 'creation.comparison.unavailable'
                  : 'creation.comparison.noFiles'
            )}
          </p>
        ) : !rows.length ? (
          <p>{t('creation.comparison.noFiles')}</p>
        ) : (
          rows.map(row => {
            const file = row.file && files.find(file => file.path === row.path)
            return (
              <button
                key={row.path}
                type="button"
                className="creation-git-file pnds-focus-ring"
                style={{ paddingInlineStart: 8 + row.depth * 14 }}
                aria-label={row.path}
                aria-pressed={file ? row.path === selected : undefined}
                aria-expanded={file ? undefined : !collapsed.has(row.path)}
                disabled={disabled}
                data-change={file?.status}
                data-project-file={
                  file ? creationProjectFileRole(row.path) : undefined
                }
                onClick={() => {
                  if (file)
                    useCreationReadingStore.getState().selectGitPath(row.path)
                  else
                    setCollapsed(previous => {
                      const next = new Set(previous)
                      if (next.has(row.path)) next.delete(row.path)
                      else next.add(row.path)
                      return next
                    })
                }}
              >
                {file ? (
                  <FileCode aria-hidden="true" />
                ) : (
                  <>
                    <ChevronRight
                      aria-hidden="true"
                      className={collapsed.has(row.path) ? '' : 'rotate-90'}
                    />
                    <Folder aria-hidden="true" />
                  </>
                )}
                <CreationFileLabel path={row.path} name={row.name} />
                {file && file.status !== 'unchanged' && (
                  <TooltipHint
                    content={t(`creation.comparison.status.${file.status}`)}
                  >
                    <small>
                      {file.status === 'added'
                        ? '+'
                        : file.status === 'deleted'
                          ? '−'
                          : 'M'}
                    </small>
                  </TooltipHint>
                )}
              </button>
            )
          })
        )}
      </div>
    </section>
  )
}
