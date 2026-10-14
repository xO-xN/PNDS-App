import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  ArrowLeft,
  Languages,
  LoaderCircle,
  Network,
  Palette,
  PanelsTopLeft,
  Plus,
  Puzzle,
  QrCode,
  Smartphone,
  X,
  type LucideIcon,
} from 'lucide-react'
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
import { useCreationTestStore } from '@/store/creation-test-store'
import { CreationErrorNotice } from './CreationErrorNotice'

const moduleDefinitions: Record<
  string,
  { copyKey: string; icon: LucideIcon; scope: string }
> = {
  qr: { copyKey: 'qr', icon: QrCode, scope: 'monitor' },
  players: { copyKey: 'players', icon: Smartphone, scope: 'client' },
  'theme-follow': { copyKey: 'themeFollow', icon: Palette, scope: 'monitor' },
  'locale-follow': {
    copyKey: 'localeFollow',
    icon: Languages,
    scope: 'monitor',
  },
  'monitor-state': {
    copyKey: 'monitorState',
    icon: PanelsTopLeft,
    scope: 'monitorServer',
  },
  hub: { copyKey: 'hub', icon: Network, scope: 'server' },
}
function moduleDefinition(id: string) {
  return (
    moduleDefinitions[id] ?? { copyKey: id, icon: Puzzle, scope: 'project' }
  )
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
  const [selected, setSelected] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<CreationError | null>(null)
  const [result, setResult] = useState<CreationModuleAddResult | null>(null)
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
  const entry = catalog?.modules.find(module => module.id === selected)
  const definition = moduleDefinition(selected ?? '')
  const DetailIcon = definition.icon
  const handoffReady =
    entry?.state === 'added' || result?.handoffRecorded === true
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
    setError(null)
    setResult(null)
  }
  const viewHandoff = () => {
    if (busy || disabled || !owns(request.current)) return
    useCreationFilesStore.getState().setActivePath(HANDOFF_PATH)
    useCreationTestStore.getState().setTab('file')
    close()
  }
  const load = async (showWhenReady = false) => {
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
      if (owns(captured)) {
        setBusy(false)
        if (showWhenReady) setOpen(true)
      }
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
        ref={trigger}
        className="creation-icon-button pnds-focus-ring"
        aria-label={t('creation.modules.open')}
        aria-busy={busy && !open}
        title={busy && !open ? t('creation.loading') : undefined}
        disabled={disabled || busy}
        onClick={() => {
          returnFocus.current = null
          setSelected(null)
          setCatalog(null)
          setResult(null)
          void load(true)
        }}
      >
        {busy && !open ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <Plus aria-hidden="true" />
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
                  {t(`creation.modules.name.${definition.copyKey}`)}
                </>
              ) : (
                t('creation.modules.open')
              )}
            </DialogTitle>
            <DialogDescription className="creation-modules-description">
              {selected
                ? t(`creation.modules.summary.${definition.copyKey}`)
                : t('creation.modules.hint')}
            </DialogDescription>
            <button
              type="button"
              className="creation-modules-close pnds-focus-ring"
              aria-label={t('creation.modules.close')}
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
                    {t('creation.modules.offline', {
                      count: catalog.modules.length,
                    })}
                  </span>
                </div>
                <ul
                  className="creation-modules-grid"
                  aria-label={t('creation.modules.select')}
                >
                  {catalog.modules.map(module => {
                    const info = moduleDefinition(module.id)
                    const Icon = info.icon
                    const id = `${descriptionId}-${module.id}`
                    return (
                      <li key={module.id}>
                        <button
                          type="button"
                          ref={node => {
                            cards.current[module.id] = node
                          }}
                          className="creation-module-card pnds-focus-ring"
                          aria-label={t(
                            `creation.modules.name.${info.copyKey}`
                          )}
                          aria-describedby={`${id}-summary ${id}-state`}
                          disabled={busy}
                          onClick={() => choose(module.id)}
                        >
                          <span className="creation-module-card-heading">
                            <Icon aria-hidden="true" />
                            <strong>
                              {t(`creation.modules.name.${info.copyKey}`)}
                            </strong>
                          </span>
                          <span
                            className="creation-module-summary"
                            id={`${id}-summary`}
                          >
                            {t(`creation.modules.summary.${info.copyKey}`)}
                          </span>
                          <span className="creation-module-card-footer">
                            <span>
                              {t(`creation.modules.scope.${info.scope}`)}
                            </span>
                            <span
                              id={`${id}-state`}
                              className="creation-modules-badge"
                              data-state={module.state}
                            >
                              {t(
                                module.state === 'available'
                                  ? module.id === 'hub'
                                    ? 'creation.modules.optional'
                                    : 'creation.modules.viewDetails'
                                  : `creation.modules.badge.${module.state}`
                              )}
                            </span>
                          </span>
                        </button>
                      </li>
                    )
                  })}
                </ul>
                <p className="creation-modules-note">
                  {t('creation.modules.sourceNote')}
                </p>
              </>
            )}
            {selected && entry && (
              <>
                <div className="creation-modules-release">
                  <span className="creation-modules-badge">
                    {t('creation.modules.moduleVersion', {
                      version: entry.version,
                    })}
                  </span>
                  <span>{t(`creation.modules.scope.${definition.scope}`)}</span>
                  {entry.state !== 'available' && (
                    <span
                      className="creation-modules-badge"
                      data-state={entry.state}
                    >
                      {t(`creation.modules.badge.${entry.state}`)}
                    </span>
                  )}
                </div>
                <dl className="creation-module-facts">
                  <dt>{t('creation.modules.facts.source')}</dt>
                  <dd>
                    {entry.compatibility && (
                      <p>
                        {t('creation.modules.compatibility', {
                          protocol: entry.compatibility.hostProtocol,
                          runtime: entry.compatibility.runtime.join(', '),
                        })}
                      </p>
                    )}
                    <p>
                      {t('creation.modules.sourceVersion', {
                        version: entry.source.version,
                      })}
                    </p>
                    {entry.version !== entry.shippedVersion && (
                      <p className="creation-modules-version-note">
                        {t('creation.modules.olderVersion', {
                          version: entry.shippedVersion,
                        })}
                      </p>
                    )}
                    <details className="creation-module-source">
                      <summary className="pnds-focus-ring">
                        {t('creation.modules.sourceDetails')}
                      </summary>
                      <p>{entry.source.repository}</p>
                      <p className="creation-module-path">
                        {entry.source.revision}
                      </p>
                    </details>
                  </dd>
                  <dt>{t('creation.modules.facts.dependencies')}</dt>
                  <dd>
                    {t(`creation.modules.description.${definition.copyKey}`)}
                  </dd>
                  <dt>{t('creation.modules.facts.boundary')}</dt>
                  <dd>
                    {t(`creation.modules.boundary.${definition.copyKey}`)}
                  </dd>
                  <dt>{t('creation.modules.facts.wiring')}</dt>
                  <dd>{t(`creation.modules.wiring.${definition.copyKey}`)}</dd>
                  <dt>{t('creation.modules.facts.verification')}</dt>
                  <dd>
                    {t(`creation.modules.verification.${definition.copyKey}`)}
                  </dd>
                  <dt>{t('creation.modules.facts.files')}</dt>
                  <dd>
                    <ul className="creation-module-paths">
                      {entry.files.map(path => (
                        <li key={path} className="creation-module-path">
                          {path}
                        </li>
                      ))}
                    </ul>
                  </dd>
                </dl>
                <p className="creation-modules-note">
                  {t('creation.modules.handoffNote')}
                </p>
                {entry.state !== 'available' && (
                  <p
                    className="creation-module-state"
                    role="status"
                    aria-atomic="true"
                  >
                    {t(`creation.modules.state.${entry.state}`)}
                  </p>
                )}
                {entry.error && <CreationErrorNotice error={entry.error} />}
              </>
            )}
            {result && (
              <div
                className="creation-module-result"
                role="status"
                aria-atomic="true"
              >
                <p>
                  {t(
                    result.handoffRecorded
                      ? 'creation.modules.complete'
                      : 'creation.modules.partial'
                  )}
                </p>
                {!result.handoffRecorded && (
                  <ul className="creation-module-paths">
                    {result.files.map(path => (
                      <li key={path} className="creation-module-path">
                        {path}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            )}
            {error && <CreationErrorNotice error={error} />}
            {busy && (
              <p
                className="creation-module-state"
                role="status"
                aria-atomic="true"
              >
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
                {t('creation.modules.back')}
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
                {t('creation.modules.reload')}
              </Button>
              {selected && (
                <Button
                  disabled={
                    busy ||
                    disabled ||
                    !entry ||
                    (!handoffReady && (!!error || entry.state === 'conflict'))
                  }
                  onClick={handoffReady ? viewHandoff : () => void add()}
                >
                  {t(
                    handoffReady
                      ? 'creation.modules.viewHandoff'
                      : entry?.state === 'needsHandoff'
                        ? 'creation.modules.retry'
                        : 'creation.modules.add'
                  )}
                </Button>
              )}
            </div>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  )
}
