import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ChevronRight, FileCode, Folder } from 'lucide-react'
import { Input } from '@/components/ui/input'
import {
  creationFileTree,
  creationProjectFileRole,
} from '@/lib/creation-file-tree'
import { CreationFileLabel } from './CreationFileLabel'
import { useCreationReadingStore } from '@/store/creation-reading-store'

/** Historical paths are comparison entries, never writable workspace files. */
export function CreationGitFiles({ disabled }: { disabled: boolean }) {
  const { t } = useTranslation()
  const comparison = useCreationReadingStore(state => state.gitComparison)
  const phase = useCreationReadingStore(state => state.gitComparisonPhase)
  const selected = useCreationReadingStore(state => state.gitPath)
  const [all, setAll] = useState(false)
  const [search, setSearch] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const files = comparison?.files ?? []
  const rows = creationFileTree(
    files
      .filter(file => all || file.status !== 'unchanged')
      .map(file => ({
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
    <section className="creation-git-files">
      <h2>{t('creation.comparison.files')}</h2>
      <div
        className="creation-git-file-filter"
        aria-label={t('creation.comparison.filter')}
      >
        <button type="button" aria-pressed={!all} onClick={() => setAll(false)}>
          {t('creation.comparison.changed', {
            count: files.filter(file => file.status !== 'unchanged').length,
          })}
        </button>
        <button type="button" aria-pressed={all} onClick={() => setAll(true)}>
          {t('creation.comparison.all', { count: files.length })}
        </button>
      </div>
      <Input
        aria-label={t('creation.comparison.search')}
        placeholder={t('creation.comparison.search')}
        value={search}
        onChange={event => setSearch(event.target.value)}
      />
      <p className="text-xs text-muted-foreground">
        {t('creation.comparison.sidebarHint')}
      </p>
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
                title={row.path}
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
                  <small title={t(`creation.comparison.status.${file.status}`)}>
                    {file.status === 'added'
                      ? '+'
                      : file.status === 'deleted'
                        ? '−'
                        : 'M'}
                  </small>
                )}
              </button>
            )
          })
        )}
      </div>
    </section>
  )
}
