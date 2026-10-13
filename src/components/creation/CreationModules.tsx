import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Plus } from 'lucide-react'
import { Button } from '@/components/ui/button'
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
  type CreationModuleCatalog,
  type CreationModuleAddResult,
  type CreationError,
} from '@/lib/tauri-bindings'
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import {
  isDraftDirty,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { HANDOFF_PATH } from '@/store/creation-handoff-store'
import { CreationErrorNotice } from './CreationErrorNotice'

// External module IDs keep their source spelling; locale segments use camelCase.
const moduleCopyKeys: Record<string, string> = {
  'theme-follow': 'themeFollow',
  'locale-follow': 'localeFollow',
  'monitor-state': 'monitorState',
}

export function CreationModules({
  identity,
  disabled,
}: {
  identity: string
  disabled: boolean
}) {
  const { t } = useTranslation()
  const [open, setOpen] = useState(false)
  const [catalog, setCatalog] = useState<CreationModuleCatalog | null>(null)
  const [selected, setSelected] = useState('qr')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<CreationError | null>(null)
  const [result, setResult] = useState<CreationModuleAddResult | null>(null)
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
  const entry = catalog?.modules.find(module => module.id === selected)
  const load = async () => {
    if (submitting.current) return
    const captured = ++request.current
    setBusy(true)
    setError(null)
    try {
      const response = await commands.getCreationModules(identity)
      if (!owns(captured)) return
      if (response.status === 'ok') setCatalog(response.data)
      else {
        setCatalog(null)
        setError(response.error)
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
  const add = async () => {
    if (
      submitting.current ||
      busy ||
      disabled ||
      !entry ||
      !catalog ||
      ['added', 'conflict'].includes(entry.state)
    )
      return
    const drafts = useCreationFilesStore.getState().drafts
    if (
      [HANDOFF_PATH, ...entry.files].some(path => {
        const draft = drafts[path]
        return draft && (isDraftDirty(draft) || draft.saving || draft.renaming)
      })
    ) {
      setError({
        code: 'versionConflict',
        detail: t('creation.modules.saveDraftFirst'),
      })
      return
    }
    submitting.current = true
    const captured = ++request.current
    setBusy(true)
    setError(null)
    setResult(null)
    try {
      const response = await commands.addCreationModule(
        identity,
        entry.id,
        entry.recordVersion,
        catalog.handoffVersion
      )
      if (!owns(captured)) return
      if (response.status === 'error') {
        setError(response.error)
        return
      }
      setResult(response.data)
      setError(response.data.error)
      // Use the existing disk workflow: no save, page reload or test start.
      await useCreationFilesStore.getState().poll()
      if (!owns(captured)) return
      const fresh = await commands.getCreationModules(identity)
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
        aria-label={t('creation.modules.open')}
        disabled={disabled}
        onClick={() => {
          setOpen(true)
          setResult(null)
          void load()
        }}
      >
        <Plus aria-hidden="true" />
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
            <DialogTitle>{t('creation.modules.open')}</DialogTitle>
            <DialogDescription>{t('creation.modules.hint')}</DialogDescription>
          </DialogHeader>
          {catalog && (
            <>
              <label className="grid gap-1 text-sm">
                <span>{t('creation.modules.select')}</span>
                <select
                  className="pnds-focus-ring rounded border bg-(--pnds-card) p-2"
                  value={selected}
                  disabled={busy}
                  onChange={event => {
                    setSelected(event.target.value)
                    setError(null)
                    setResult(null)
                  }}
                >
                  {catalog.modules.map(module => (
                    <option key={module.id} value={module.id}>
                      {t(
                        `creation.modules.name.${moduleCopyKeys[module.id] ?? module.id}`
                      )}
                    </option>
                  ))}
                </select>
              </label>
              {entry && (
                <div className="space-y-2 text-start text-sm">
                  <p>
                    {t(
                      `creation.modules.description.${moduleCopyKeys[entry.id] ?? entry.id}`
                    )}
                  </p>
                  <p>
                    {t('creation.modules.version', {
                      version: entry.version,
                      sourceVersion: entry.source.version,
                    })}
                  </p>
                  <p className="break-all text-xs">
                    {entry.source.repository} @ {entry.source.revision}
                  </p>
                  <p role="status">
                    {t(`creation.modules.state.${entry.state}`)}
                  </p>
                  {entry.error && <CreationErrorNotice error={entry.error} />}
                  <ul className="list-inside list-disc text-xs">
                    {entry.files.map(path => (
                      <li key={path}>{path}</li>
                    ))}
                  </ul>
                </div>
              )}
            </>
          )}
          {result && (
            <div role="status">
              <p>
                {t(
                  result.handoffRecorded
                    ? 'creation.modules.complete'
                    : 'creation.modules.partial'
                )}
              </p>
              {!result.handoffRecorded && (
                <ul className="list-inside list-disc text-xs">
                  {result.files.map(path => (
                    <li key={path}>{path}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
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
                !!error ||
                !entry ||
                entry.state === 'added' ||
                entry.state === 'conflict'
              }
              onClick={() => void add()}
            >
              {t(
                entry?.state === 'needsHandoff'
                  ? 'creation.modules.retry'
                  : 'creation.modules.add'
              )}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
