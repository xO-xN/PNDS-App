import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  commands,
  type CreationError,
  type CreationOption,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import { useProjectStore } from '@/store/project-store'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from '@/components/ui/dialog'
import { CreationErrorNotice } from './CreationErrorNotice'

export function CreationProjectPicker({
  onClose,
  onNewProject,
}: {
  onClose: () => void
  onNewProject: () => void
}) {
  const { t } = useTranslation()
  const recent = useCreationStore(state => state.recentPaths)
  const performance = useProjectStore(state => state.recentProjectPaths)
  const utilities = useProjectStore(state => state.utilityPaths)
  const opening = useCreationStore(state => state.opening)
  const openingError = useCreationStore(state => state.error)
  const [options, setOptions] = useState<CreationOption[] | null>(null)
  const [error, setError] = useState<CreationError | null>(null)
  useEffect(() => {
    let live = true
    void commands
      .describeCreationProjects(
        [...new Set([...recent, ...performance, ...utilities])].slice(0, 100)
      )
      .then(result => {
        if (!live) return
        if (result.status === 'ok') setOptions(result.data)
        else setError(result.error)
      })
      .catch(error => {
        if (live) setError(creationTransportError(error))
      })
    return () => {
      live = false
    }
  }, [recent, performance, utilities])
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !opening) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="creation-project-picker"
      >
        <DialogTitle>{t('creation.switchProject')}</DialogTitle>
        <DialogDescription>{t('creation.selectorHint')}</DialogDescription>
        <div
          className="creation-project-picker-list space-y-2"
          aria-busy={!options && !error}
        >
          {error && <CreationErrorNotice error={error} />}
          {openingError && <CreationErrorNotice error={openingError} />}
          {!options && !error && <p role="status">{t('creation.loading')}</p>}
          {options?.map(option => (
            <Button
              key={option.path}
              variant="outline"
              disabled={opening || !option.project}
              className="h-auto w-full flex-col items-start whitespace-normal p-3 text-start"
              onClick={() => {
                void useCreationStore
                  .getState()
                  .open(option.path)
                  .then(success => {
                    if (success) onClose()
                  })
              }}
            >
              <span>{option.project?.name ?? option.path}</span>
              <span className="break-all text-xs">{option.path}</span>
              <span className="text-xs">
                {option.project
                  ? t(`creation.source.${option.project.source}`)
                  : option.error
                    ? t(`creation.error.${option.error.code}`)
                    : ''}
              </span>
            </Button>
          ))}
        </div>
        <Button
          disabled={opening}
          onClick={() => {
            void useCreationStore
              .getState()
              .pick()
              .then(success => {
                if (success) onClose()
              })
          }}
        >
          {t('creation.openFolder')}
        </Button>
        <Button variant="outline" disabled={opening} onClick={onClose}>
          {t('creation.cancel')}
        </Button>
        <Button variant="outline" disabled={opening} onClick={onNewProject}>
          {t('creation.newProject.open')}
        </Button>
      </DialogContent>
    </Dialog>
  )
}
