import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Package } from 'lucide-react'
import {
  commands,
  type CreationError,
  type CreationFile,
} from '@/lib/tauri-bindings'
import {
  creationDependencies,
  type CreationDependency,
} from '@/lib/creation-dependencies'
import {
  useCreationStore,
  creationTransportError,
} from '@/store/creation-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Button } from '@/components/ui/button'
import { CreationErrorNotice } from './CreationErrorNotice'
import { CreationLibraries } from './CreationLibraries'

export function CreationDependencies({
  identity,
  files,
  disabled,
  editable,
  onFocus,
}: {
  identity: string
  files: CreationFile[]
  disabled: boolean
  editable: boolean
  onFocus: () => void
}) {
  const { t, i18n } = useTranslation()
  const [open, setOpen] = useState(false)
  const [manage, setManage] = useState(false)
  const [retry, setRetry] = useState(0)
  const [result, setResult] = useState<{
    key: string
    dependencies: CreationDependency[] | null
    error: CreationError | null
  } | null>(null)
  const trigger = useRef<HTMLButtonElement>(null)
  const manageAfterClose = useRef(false)
  const manifestExists = files.some(file => file.path === 'manifest.json')
  const packageExists = files.some(file => file.path === 'package.json')
  const revision = useCreationFilesStore(
    state =>
      `${state.fileRevisions['manifest.json'] ?? 0}:${state.fileRevisions['package.json'] ?? 0}`
  )
  const key = JSON.stringify([
    identity,
    revision,
    manifestExists,
    packageExists,
  ])
  const current = result?.key === key ? result : null
  const dependencies = current?.dependencies ?? null
  const error = current?.error ?? null
  useEffect(() => {
    if (!open) return
    let live = true
    const owns = () =>
      live &&
      useCreationStore.getState().workspace?.project.identity === identity
    setResult(null)
    const paths = [
      manifestExists ? 'manifest.json' : null,
      packageExists ? 'package.json' : null,
    ].filter((path): path is string => path !== null)
    void (async () => {
      try {
        const results = await Promise.allSettled(
          paths.map(path => commands.readCreationFile(identity, path))
        )
        if (!owns()) return
        const saved: Record<string, string> = {}
        let failure: CreationError | null = null
        results.forEach((result, index) => {
          const path = paths[index]
          if (path === undefined) return
          if (result.status === 'rejected')
            failure ??= creationTransportError(result.reason)
          else if (result.value.status === 'error')
            failure ??= result.value.error
          else if (result.value.data.kind !== 'text')
            failure ??= { code: 'invalidUtf8', detail: path }
          else saved[path] = result.value.data.text
        })
        if (failure) throw failure
        setResult({
          key,
          error: null,
          dependencies: creationDependencies(
            saved['manifest.json'] ?? null,
            saved['package.json'] ?? null
          ),
        })
      } catch (cause) {
        if (owns())
          setResult({
            key,
            dependencies: null,
            error:
              cause instanceof Error
                ? {
                    code: 'manifestInvalid',
                    detail: t('creation.dependencies.invalid', {
                      path: cause.message,
                    }),
                  }
                : creationTransportError(cause),
          })
      }
    })()
    return () => {
      live = false
    }
  }, [identity, open, manifestExists, packageExists, key, retry, t])
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="treeitem"
        aria-level={1}
        aria-label={t('creation.dependencies.title')}
        aria-haspopup="dialog"
        disabled={disabled}
        className="creation-file-row creation-tree-row pnds-focus-ring"
        onFocus={onFocus}
        onClick={() => {
          setResult(null)
          setOpen(true)
        }}
      >
        <Package aria-hidden="true" />
        <span className="creation-file-name">
          {t('creation.dependencies.title')}
        </span>
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent
          className="creation-dependencies-dialog"
          onCloseAutoFocus={event => {
            event.preventDefault()
            if (manageAfterClose.current) {
              manageAfterClose.current = false
              setManage(true)
            } else trigger.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('creation.dependencies.title')}</DialogTitle>
            <DialogDescription>
              {t('creation.dependencies.hint')}
            </DialogDescription>
          </DialogHeader>
          <div className="creation-dependencies-list">
            {error ? (
              <>
                <CreationErrorNotice error={error} />
                <Button
                  variant="outline"
                  onClick={() => setRetry(value => value + 1)}
                >
                  {t('creation.dependencies.retry')}
                </Button>
              </>
            ) : dependencies === null ? (
              <p role="status">{t('creation.loading')}</p>
            ) : dependencies.length === 0 ? (
              <p>{t('creation.dependencies.empty')}</p>
            ) : (
              <ul>
                {dependencies.map(dependency => {
                  const mismatch =
                    !!dependency.sharedVersion &&
                    !!dependency.packageVersion &&
                    dependency.sharedVersion !== dependency.packageVersion
                  const purpose = `creation.libraries.purpose.${dependency.name}`
                  return (
                    <li key={dependency.name}>
                      <strong>{dependency.name}</strong>
                      {i18n.exists(purpose) && <p>{t(purpose)}</p>}
                      {dependency.packageVersion && (
                        <p>
                          {t('creation.dependencies.declaredVersion', {
                            version: dependency.packageVersion,
                          })}
                        </p>
                      )}
                      {dependency.sharedVersion && (
                        <p>
                          {t('creation.dependencies.sharedVersion', {
                            version: dependency.sharedVersion,
                          })}
                        </p>
                      )}
                      <p>
                        {t(
                          mismatch
                            ? 'creation.dependencies.mixed'
                            : dependency.sharedVersion
                              ? 'creation.dependencies.app'
                              : 'creation.dependencies.project'
                        )}
                      </p>
                      {dependency.development && (
                        <small>{t('creation.dependencies.development')}</small>
                      )}
                      {dependency.optional && (
                        <small>{t('creation.dependencies.optional')}</small>
                      )}
                    </li>
                  )
                })}
              </ul>
            )}
          </div>
          {editable && (
            <Button
              variant="outline"
              disabled={disabled}
              onClick={() => {
                manageAfterClose.current = true
                setOpen(false)
              }}
            >
              {t('creation.libraries.open')}
            </Button>
          )}
        </DialogContent>
      </Dialog>
      <CreationLibraries
        identity={identity}
        disabled={disabled}
        active={manage}
        onClose={() => setManage(false)}
        onReturnFocus={() => trigger.current?.focus()}
      />
    </>
  )
}
