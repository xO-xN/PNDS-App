import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { PackagePlus } from 'lucide-react'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  commands,
  type CreationError,
  type CreationLibraryCatalog,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import {
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { CreationErrorNotice } from './CreationErrorNotice'

export function CreationLibraries({
  identity,
  disabled,
}: {
  identity: string
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<CreationLibraryCatalog | null>(null)
  const [selected, setSelected] = useState('p5')
  const [projectVersion, setProjectVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<CreationError | null>(null)
  const [complete, setComplete] = useState(false)
  const request = useRef(0)
  const submitting = useRef(false)
  useEffect(
    () => () => {
      request.current++
    },
    []
  )
  const owns = (captured: number) =>
    captured === request.current &&
    useCreationStore.getState().workspace?.project.identity === identity
  const entry = catalog?.libraries.find(library => library.id === selected)
  const alreadyAdded = entry?.referencedVersion === entry?.version && !!entry
  const load = async () => {
    if (submitting.current) return
    const captured = ++request.current
    setBusy(true)
    setError(null)
    try {
      const result = await commands.getCreationLibraries(identity)
      if (!owns(captured)) return
      if (result.status === 'ok') {
        setCatalog(result.data)
        if (!result.data.libraries.some(library => library.id === selected))
          setSelected(result.data.libraries[0]?.id ?? '')
      } else {
        setCatalog(null)
        setError(result.error)
      }
    } catch (cause) {
      if (owns(captured)) {
        setCatalog(null)
        setError(creationTransportError(cause))
      }
    } finally {
      if (owns(captured)) setBusy(false)
    }
  }
  const manifestDraftBlocked = () => {
    const draft = useCreationFilesStore.getState().drafts['manifest.json']
    return !!draft && (isDraftDirty(draft) || draft.saving || draft.renaming)
  }
  const adopt = async () => {
    if (
      submitting.current ||
      busy ||
      disabled ||
      !entry ||
      !catalog ||
      alreadyAdded
    )
      return
    if (manifestDraftBlocked()) {
      setError({
        code: 'versionConflict',
        detail: t('creation.libraries.saveDraftFirst'),
      })
      return
    }
    submitting.current = true
    const captured = ++request.current
    setBusy(true)
    setError(null)
    setComplete(false)
    try {
      const synchronized = await useCreationFilesStore.getState().poll()
      if (!owns(captured)) return
      if (!synchronized || manifestDraftBlocked()) {
        setError({
          code: 'versionConflict',
          detail: t('creation.libraries.saveDraftFirst'),
        })
        return
      }
      const result = await commands.adoptCreationLibrary(identity, {
        id: entry.id,
        version: entry.version,
        projectVersion: projectVersion.trim(),
        manifestVersion: catalog.manifestVersion,
      })
      if (!owns(captured)) return
      if (result.status === 'error') {
        setError(result.error)
        return
      }
      setComplete(true)
      await useCreationFilesStore.getState().poll()
      if (!owns(captured)) return
      const fresh = await commands.getCreationLibraries(identity)
      if (!owns(captured)) return
      if (fresh.status === 'ok') setCatalog(fresh.data)
      else setError(fresh.error)
    } catch (cause) {
      if (owns(captured)) setError(creationTransportError(cause))
    } finally {
      submitting.current = false
      if (owns(captured)) setBusy(false)
    }
  }
  return (
    <>
      <button
        type="button"
        className="creation-icon-button pnds-focus-ring"
        aria-label={t('creation.libraries.open')}
        title={t('creation.libraries.open')}
        disabled={disabled}
        onClick={() => {
          setOpen(true)
          setComplete(false)
          setProjectVersion('')
          void load()
        }}
      >
        <PackagePlus aria-hidden="true" />
      </button>
      <Dialog
        open={open}
        onOpenChange={next => {
          if (!busy) {
            if (!next) request.current++
            setOpen(next)
          }
        }}
      >
        <DialogContent
          className="max-h-[85vh] overflow-auto"
          showCloseButton={!busy}
        >
          <DialogHeader>
            <DialogTitle>{t('creation.libraries.open')}</DialogTitle>
            <DialogDescription>
              {t('creation.libraries.hint')}
            </DialogDescription>
          </DialogHeader>
          {catalog && (
            <>
              <div className="grid gap-1 text-sm">
                <label htmlFor="creation-shared-library">
                  {t('creation.libraries.select')}
                </label>
                <Select
                  value={selected}
                  disabled={busy}
                  onValueChange={value => {
                    setSelected(value)
                    setError(null)
                    setComplete(false)
                  }}
                >
                  <SelectTrigger
                    id="creation-shared-library"
                    aria-describedby="creation-shared-library-purpose"
                  >
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {catalog.libraries.map(library => (
                      <SelectItem key={library.id} value={library.id}>
                        {library.id} {library.version}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              {entry && (
                <div className="space-y-2 text-start text-sm">
                  <p id="creation-shared-library-purpose">
                    {t(`creation.libraries.purpose.${entry.id}`)}
                  </p>
                  <p>{t(`creation.libraries.kind.${entry.kind}`)}</p>
                  <p>
                    {t('creation.libraries.fixedVersion', {
                      version: entry.version,
                    })}
                  </p>
                  {entry.referencedVersion && (
                    <p>
                      {t('creation.libraries.reference', {
                        version: entry.referencedVersion,
                      })}
                    </p>
                  )}
                  <p className="break-all text-xs">{entry.source.url}</p>
                  <p className="break-all text-xs">{entry.source.integrity}</p>
                  <p>{t('creation.libraries.wiring')}</p>
                  {alreadyAdded ? (
                    <p role="status">{t('creation.libraries.alreadyAdded')}</p>
                  ) : (
                    <div className="space-y-1">
                      <label className="grid gap-1">
                        <span>{t('creation.libraries.projectVersion')}</span>
                        <input
                          className="pnds-focus-ring rounded border bg-(--pnds-card) p-2"
                          aria-describedby="creation-shared-current-version"
                          value={projectVersion}
                          disabled={busy}
                          placeholder={catalog.projectVersion}
                          onChange={event =>
                            setProjectVersion(event.target.value)
                          }
                        />
                      </label>
                      <p
                        id="creation-shared-current-version"
                        className="text-xs"
                      >
                        {t('creation.libraries.currentProjectVersion', {
                          version: catalog.projectVersion,
                        })}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
          {complete && <p role="status">{t('creation.libraries.complete')}</p>}
          {error && <CreationErrorNotice error={error} />}
          {busy && <p role="status">{t('creation.loading')}</p>}
          <DialogFooter>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => {
                request.current++
                setOpen(false)
              }}
            >
              {t('creation.cancel')}
            </Button>
            <Button
              variant="outline"
              disabled={busy}
              onClick={() => void load()}
            >
              {t('creation.modules.reload')}
            </Button>
            <Button
              disabled={
                busy ||
                disabled ||
                !entry ||
                alreadyAdded ||
                !projectVersion.trim() ||
                projectVersion.trim() === catalog?.projectVersion
              }
              onClick={() => void adopt()}
            >
              {t('creation.libraries.adopt')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
