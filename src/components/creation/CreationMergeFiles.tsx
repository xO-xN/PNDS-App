import { useState } from 'react'
import { FileCode, Folder, ChevronRight } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { SearchField } from '@/components/ui/search-field'
import { creationFileTree } from '@/lib/creation-file-tree'
import { useCreationMergeStore } from '@/store/creation-merge-store'
import { CreationFileLabel } from './CreationFileLabel'
import './creation-version-files.css'

export function CreationMergeFiles() {
  const { t } = useTranslation()
  const candidate = useCreationMergeStore(state => state.candidate)
  const selected = useCreationMergeStore(state => state.selectedPath)
  const [query, setQuery] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const files = candidate?.files ?? []
  const rows = creationFileTree(
    files.map(file => ({
      path: file.path,
      kind: 'text' as const,
      category: 'system' as const,
      size: 0,
    })),
    [],
    collapsed,
    query
  )
  return (
    <section className="creation-version-files creation-git-files">
      <header>
        <h2>{t('creation.merge.changedFiles')}</h2>
        <span>{files.length}</span>
      </header>
      <div className="creation-version-file-search">
        <SearchField
          variant="secondary"
          size="sm"
          value={query}
          onValueChange={setQuery}
          aria-label={t('creation.comparison.search')}
          placeholder={t('creation.comparison.search')}
        />
      </div>
      <div
        className="creation-git-file-list"
        aria-label={t('creation.merge.changedFiles')}
      >
        {!rows.length && <p>{t('creation.merge.noChanges')}</p>}
        {rows.map(row => {
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
              onClick={() => {
                if (file) useCreationMergeStore.getState().select(file.path)
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
              {file && (
                <small
                  className={
                    file.conflict && !file.resolved
                      ? 'creation-merge-conflict'
                      : undefined
                  }
                >
                  {file.conflict && !file.resolved
                    ? t('creation.merge.conflict')
                    : file.status === 'D'
                      ? '−'
                      : file.status === 'A'
                        ? '+'
                        : 'M'}
                </small>
              )}
            </button>
          )
        })}
      </div>
    </section>
  )
}
