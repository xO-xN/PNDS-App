import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  BrainCircuit,
  LoaderCircle,
  Network,
  PackagePlus,
  Paintbrush,
  Plug,
  QrCode,
  Radio,
  Server,
  X,
  type LucideIcon,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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

const libraryIcons: Record<string, LucideIcon> = {
  p5: Paintbrush,
  ml5: BrainCircuit,
  express: Server,
  qrcode: QrCode,
  'socket.io': Network,
  'socket.io-client': Plug,
  'osc-min': Radio,
}

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
  const [selected, setSelected] = useState<string | null>(null)
  const [projectVersion, setProjectVersion] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<CreationError | null>(null)
  const [complete, setComplete] = useState(false)
  const descriptionId = useId()
  const trigger = useRef<HTMLButtonElement>(null)
  const title = useRef<HTMLHeadingElement>(null)
  const body = useRef<HTMLDivElement>(null)
  const cards = useRef<Record<string, HTMLButtonElement | null>>({})
  const returnFocus = useRef<string | null>(null)
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
  const DetailIcon = libraryIcons[selected ?? ''] ?? PackagePlus
  useEffect(() => {
    if (!open) return
    if (body.current) body.current.scrollTop = 0
    if (selected || !returnFocus.current) title.current?.focus()
    else cards.current[returnFocus.current]?.focus()
  }, [open, selected])
  const close = () => {
    if (submitting.current) return
    request.current++
    setOpen(false)
  }
  const choose = (id: string | null) => {
    if (busy) return
    if (id) returnFocus.current = id
    setSelected(id)
    setProjectVersion('')
    setError(null)
    setComplete(false)
  }
  const load = async (showWhenReady = false) => {
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
          setSelected(null)
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
      if (owns(captured)) {
        setBusy(false)
        if (showWhenReady) setOpen(true)
      }
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
        ref={trigger}
        className="creation-icon-button pnds-focus-ring"
        aria-label={t('creation.libraries.open')}
        aria-busy={busy && !open}
        title={
          busy && !open ? t('creation.loading') : t('creation.libraries.open')
        }
        disabled={disabled || busy}
        onClick={() => {
          returnFocus.current = null
          setSelected(null)
          setCatalog(null)
          setComplete(false)
          setProjectVersion('')
          void load(true)
        }}
      >
        {busy && !open ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <PackagePlus aria-hidden="true" />
        )}
      </button>
      <Dialog
        open={open}
        onOpenChange={next => {
          if (!busy && !next) close()
        }}
      >
        <DialogContent
          className="creation-modules-dialog"
          data-view={selected ? 'details' : 'catalog'}
          showCloseButton={false}
          onOpenAutoFocus={event => {
            event.preventDefault()
            title.current?.focus()
          }}
          onCloseAutoFocus={event => {
            event.preventDefault()
            trigger.current?.focus()
          }}
        >
          <DialogHeader className="creation-modules-header">
            <DialogTitle
              ref={title}
              tabIndex={-1}
              className="creation-modules-title"
            >
              {selected ? (
                <>
                  <DetailIcon aria-hidden="true" />
                  {selected}
                </>
              ) : (
                t('creation.libraries.open')
              )}
            </DialogTitle>
            <DialogDescription className="creation-modules-description">
              {entry
                ? t(`creation.libraries.purpose.${entry.id}`)
                : t('creation.libraries.hint')}
            </DialogDescription>
            <button
              type="button"
              className="creation-modules-close pnds-focus-ring"
              aria-label={t('creation.libraries.close')}
              disabled={busy}
              onClick={close}
            >
              <X aria-hidden="true" />
            </button>
          </DialogHeader>
          <div ref={body} className="creation-modules-body">
            {!selected && catalog && (
              <>
                <div className="creation-modules-release">
                  <span className="creation-modules-badge">
                    {t('creation.modules.appVersion', {
                      version: __APP_VERSION__,
                    })}
                  </span>
                  <span>
                    {t('creation.libraries.offline', {
                      count: catalog.libraries.length,
                    })}
                  </span>
                </div>
                <ul
                  className="creation-modules-grid"
                  aria-label={t('creation.libraries.select')}
                >
                  {catalog.libraries.map(library => {
                    const Icon = libraryIcons[library.id] ?? PackagePlus
                    const id = `${descriptionId}-${library.id}`
                    const state =
                      library.referencedVersion === library.version
                        ? 'added'
                        : library.referencedVersion
                          ? 'different'
                          : 'available'
                    return (
                      <li key={library.id}>
                        <button
                          type="button"
                          ref={node => {
                            cards.current[library.id] = node
                          }}
                          className="creation-module-card pnds-focus-ring"
                          aria-label={library.id}
                          aria-describedby={`${id}-summary ${id}-state`}
                          disabled={busy}
                          onClick={() => choose(library.id)}
                        >
                          <span className="creation-module-card-heading">
                            <Icon aria-hidden="true" />
                            <strong>{library.id}</strong>
                          </span>
                          <span
                            className="creation-module-summary"
                            id={`${id}-summary`}
                          >
                            {t(`creation.libraries.purpose.${library.id}`)}
                          </span>
                          <span className="creation-module-card-footer">
                            <span>
                              {library.version} ·{' '}
                              {t(`creation.libraries.scope.${library.kind}`)}
                            </span>
                            <span
                              id={`${id}-state`}
                              className="creation-modules-badge"
                              data-state={state}
                            >
                              {t(`creation.libraries.badge.${state}`)}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className="creation-modules-note">
                  {t('creation.libraries.wiring')}
                </p>
              </>
            )}
            {entry && catalog && (
              <>
                <div className="creation-modules-release">
                  <span className="creation-modules-badge">
                    {entry.version}
                  </span>
                  <span>{t(`creation.libraries.scope.${entry.kind}`)}</span>
                  {alreadyAdded && (
                    <span className="creation-modules-badge" data-state="added">
                      {t('creation.libraries.badge.added')}
                    </span>
                  )}
                </div>
                <dl className="creation-module-facts">
                  <dt>{t('creation.libraries.facts.version')}</dt>
                  <dd>
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
                    {entry.referencedVersion && !alreadyAdded && (
                      <p className="creation-modules-version-note">
                        {t('creation.libraries.replaceReference')}
                      </p>
                    )}
                    <details className="creation-module-source">
                      <summary className="pnds-focus-ring">
                        {t('creation.libraries.sourceDetails')}
                      </summary>
                      <p>{entry.source.url}</p>
                      <p className="creation-module-path">
                        {entry.source.integrity}
                      </p>
                    </details>
                  </dd>
                  <dt>{t('creation.libraries.facts.runtime')}</dt>
                  <dd>{t(`creation.libraries.kind.${entry.kind}`)}</dd>
                  <dt>{t('creation.libraries.facts.wiring')}</dt>
                  <dd>{t('creation.libraries.wiring')}</dd>
                  {!alreadyAdded && (
                    <>
                      <dt>{t('creation.libraries.facts.projectVersion')}</dt>
                      <dd className="space-y-2">
                        <label className="grid gap-2">
                          <span>{t('creation.libraries.projectVersion')}</span>
                          <Input
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
                      </dd>
                    </>
                  )}
                </dl>
                {alreadyAdded && (
                  <p className="creation-module-state" role="status">
                    {t('creation.libraries.alreadyAdded')}
                  </p>
                )}
              </>
            )}
            {complete && (
              <p
                className="creation-module-result"
                role="status"
                aria-atomic="true"
              >
                {t('creation.libraries.complete')}
              </p>
            )}
            {error && <CreationErrorNotice error={error} />}
            {busy && (
              <p className="creation-module-state" role="status">
                {t('creation.loading')}
              </p>
            )}
          </div>
          <DialogFooter className="creation-modules-footer">
            {selected ? (
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => choose(null)}
              >
                <ArrowLeft className="rtl:rotate-180" aria-hidden="true" />
                {t('creation.libraries.back')}
              </Button>
            ) : (
              <Button variant="outline" disabled={busy} onClick={close}>
                {t('creation.cancel')}
              </Button>
            )}
            <div className="creation-modules-footer-actions">
              <Button
                variant="outline"
                disabled={busy}
                onClick={() => void load()}
              >
                {t('creation.libraries.reload')}
              </Button>
              {selected && (
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
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
