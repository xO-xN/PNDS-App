import { useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ChevronRight,
  FileChartLine,
  FolderOpen,
  GitBranch,
  Plus,
  X,
} from 'lucide-react'
import pndsIcon from '@/assets/pnds-icon.png'
import { Button } from '@/components/ui/button'
import { useCreationStore } from '@/store/creation-store'
import './creation-home.css'

const COLLAPSED_RECENTS = 4

export function CreationHome({
  disabled,
  onNewProject,
  onCloneProject,
}: {
  disabled: boolean
  onNewProject: (trigger: HTMLButtonElement) => void
  onCloneProject: (trigger: HTMLButtonElement) => void
}) {
  const { t } = useTranslation()
  const recent = useCreationStore(state => state.recentPaths)
  const [expanded, setExpanded] = useState(false)
  const headingId = useId()
  const listId = useId()
  const listRef = useRef<HTMLUListElement>(null)
  const openFolder = useRef<HTMLButtonElement>(null)
  const paths = expanded ? recent : recent.slice(0, COLLAPSED_RECENTS)

  const removeRecent = (path: string, index: number) => {
    // Move focus to a surviving row before removing the focused button.
    const rows = listRef.current?.querySelectorAll<HTMLButtonElement>(
      '[data-creation-recent-open]'
    )
    const next = rows?.[index + 1] ?? rows?.[index - 1] ?? openFolder.current
    next?.focus()
    useCreationStore.getState().removeRecent(path)
    if (recent.length <= COLLAPSED_RECENTS + 1) setExpanded(false)
  }

  return (
    <main data-creation-home="" className="creation-home">
      <div className="creation-home-content">
        <header className="creation-home-heading">
          <div>
            <h1>{t('creation.workspace')}</h1>
            <p>{t('creation.homeHint')}</p>
          </div>
          <div className="creation-home-brand">
            <img src={pndsIcon} alt="" width={56} height={56} />
            <bdi>{t('app.brand')}</bdi>
          </div>
        </header>

        <div className="creation-home-actions">
          <Button
            ref={openFolder}
            type="button"
            disabled={disabled}
            onClick={() => void useCreationStore.getState().pick()}
          >
            <FolderOpen aria-hidden="true" />
            {t('creation.openFolder')}
          </Button>
          <Button
            type="button"
            variant="outline"
            disabled={disabled}
            onClick={event => onNewProject(event.currentTarget)}
          >
            <Plus aria-hidden="true" />
            {t('creation.newProject.open')}
          </Button>
          <Button
            type="button"
            variant="ghost"
            className="creation-home-clone"
            disabled={disabled}
            onClick={event => onCloneProject(event.currentTarget)}
          >
            <GitBranch aria-hidden="true" />
            {t('creation.github.clone')}
          </Button>
        </div>

        <section className="creation-home-recent" aria-labelledby={headingId}>
          <header>
            <h2 id={headingId}>{t('creation.recent')}</h2>
            <span>{t('creation.recentCount', { count: recent.length })}</span>
          </header>
          {paths.length > 0 ? (
            <ul id={listId} ref={listRef}>
              {paths.map((path, index) => {
                const separator = path.lastIndexOf('/')
                const name = path.slice(separator + 1) || path
                const parent =
                  separator >= 0 ? path.slice(0, separator) || '/' : ''
                const nameId = `${listId}-${index}-name`
                const parentId = `${listId}-${index}-parent`
                return (
                  <li
                    key={path}
                    className="creation-recent-row"
                    data-creation-recent-path={path}
                  >
                    <button
                      type="button"
                      className="creation-recent-open pnds-focus-ring"
                      data-creation-recent-open=""
                      aria-labelledby={nameId}
                      aria-describedby={parent ? parentId : undefined}
                      title={path}
                      disabled={disabled}
                      onClick={() =>
                        void useCreationStore.getState().open(path)
                      }
                    >
                      <span className="creation-recent-glyph">
                        <FileChartLine aria-hidden="true" />
                      </span>
                      <span className="creation-recent-copy">
                        <bdi id={nameId}>{name}</bdi>
                        {parent && (
                          <bdi
                            id={parentId}
                            className="creation-recent-parent"
                            dir="ltr"
                          >
                            {parent}
                          </bdi>
                        )}
                      </span>
                      <ChevronRight
                        className="creation-recent-arrow"
                        aria-hidden="true"
                      />
                    </button>
                    <button
                      type="button"
                      className="creation-recent-remove pnds-focus-ring"
                      aria-label={t('creation.removeRecent', { name })}
                      aria-describedby={parent ? parentId : undefined}
                      disabled={disabled}
                      onClick={() => removeRecent(path, index)}
                    >
                      <X size={14} aria-hidden="true" />
                    </button>
                  </li>
                )
              })}
            </ul>
          ) : (
            <p className="creation-home-empty">{t('creation.noRecent')}</p>
          )}
          {recent.length > COLLAPSED_RECENTS && (
            <button
              type="button"
              className="creation-home-expand pnds-focus-ring"
              aria-expanded={expanded}
              aria-controls={listId}
              disabled={disabled}
              onClick={() => setExpanded(value => !value)}
            >
              {expanded
                ? t('creation.recentShowLess')
                : t('creation.recentShowAll', { count: recent.length })}
            </button>
          )}
        </section>
      </div>
    </main>
  )
}
