import { TooltipHint } from '@/components/ui/tooltip'
import { useEffect, useEffectEvent, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { FileText, X } from 'lucide-react'
import { toast } from 'sonner'
import { open as pickFile } from '@tauri-apps/plugin-dialog'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  commands,
  type CreationMaterial,
  type CreationMaterialPage,
  type MaterialError,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useCreationMaterialsStore } from '@/store/creation-materials-store'

export function CreationMaterials({
  identity,
  disabled,
}: {
  identity: string
  disabled: boolean
}) {
  const { t } = useTranslation()
  const intent = useCreationMaterialsStore(state => state.request)
  const shown = intent?.identity === identity
  const [materials, setMaterials] = useState<CreationMaterial[]>([])
  const [selected, setSelected] = useState<CreationMaterial | null>(null)
  const [page, setPage] = useState<CreationMaterialPage | null>(null)
  const [text, setText] = useState('')
  const [error, setError] = useState<MaterialError | null>(null)
  const [busy, setBusy] = useState(false)
  const [saving, setSaving] = useState(false)
  const generation = useRef(0)
  const pending = useRef(false)
  const publishing = useRef(false)
  const trigger = useRef<HTMLButtonElement>(null)
  const addButton = useRef<HTMLButtonElement>(null)
  const owns = (captured: number) =>
    captured === generation.current &&
    useCreationMaterialsStore.getState().request?.identity === identity &&
    useCreationStore.getState().workspace?.project.identity === identity

  const view = async (material: CreationMaterial, more = false) => {
    const captured = ++generation.current
    pending.current = true
    setBusy(true)
    setError(null)
    setSelected(material)
    if (!more) {
      setPage(null)
      setText('')
    }
    try {
      const result = await commands.readCreationMaterial(identity, {
        id: material.id,
        version: material.version,
        offset: more ? (page?.nextOffset ?? 0) : 0,
        pageLength: 65536,
      })
      if (!owns(captured)) return
      if (result.status === 'error') {
        setError(result.error)
        return
      }
      setPage(result.data)
      setText(previous =>
        more ? previous + result.data.text : result.data.text
      )
    } catch {
      if (owns(captured)) setError('storage')
    } finally {
      if (owns(captured)) {
        pending.current = false
        setBusy(false)
      }
    }
  }

  const load = async () => {
    if (!shown) return
    const captured = ++generation.current
    pending.current = true
    setBusy(true)
    setError(null)
    setSelected(null)
    setPage(null)
    setText('')
    try {
      const result = await commands.listCreationMaterials(identity)
      if (!owns(captured)) return
      if (result.status === 'error') {
        setError(result.error)
        return
      }
      setMaterials(result.data)
      if (intent?.id) {
        const material = result.data.find(entry => entry.id === intent.id)
        if (!material) setError('missing')
        else if (intent.version && intent.version !== material.version)
          setError('versionConflict')
        else {
          await view(material)
          return
        }
      }
    } catch {
      if (owns(captured)) setError('storage')
    } finally {
      if (owns(captured)) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  const loadOnOpen = useEffectEvent(load)
  const invalidate = useEffectEvent(() => {
    generation.current++
    pending.current = false
  })
  const reportMigrationFailure = useEffectEvent((code: MaterialError) => {
    toast.error(t('creation.materials.migrationFailed'), {
      id: `creation-materials-${identity}`,
      duration: 8000,
      description: t(`creation.materials.error.${code}`),
      action: {
        label: t('creation.materials.openAction'),
        onClick: () => {
          const state = useCreationStore.getState()
          const button = trigger.current
          if (
            !state.active ||
            state.opening ||
            state.modePhase !== 'idle' ||
            state.workspace?.project.identity !== identity ||
            !button?.isConnected ||
            button.disabled
          )
            return
          if (
            useCreationMaterialsStore.getState().request?.identity === identity
          )
            return
          button.click()
        },
      },
    })
  })
  useEffect(() => {
    // Native listing migrates legacy materials before the project is copied.
    // Opening the dialog reads again and exposes its normal retryable errors;
    // background initialization owns no dialog state and cannot block chat.
    let current = true
    const report = (code: MaterialError) => {
      if (
        current &&
        useCreationStore.getState().workspace?.project.identity === identity
      )
        reportMigrationFailure(code)
    }
    void commands
      .listCreationMaterials(identity)
      .then(result => {
        if (result.status === 'error') report(result.error)
      })
      .catch(() => report('storage'))
    return () => {
      current = false
      toast.dismiss(`creation-materials-${identity}`)
    }
  }, [identity])
  useEffect(() => {
    void loadOnOpen()
    return () => invalidate()
  }, [intent])
  useEffect(
    () => () => {
      if (useCreationMaterialsStore.getState().request?.identity === identity) {
        useCreationMaterialsStore.getState().close()
      }
    },
    [identity]
  )

  const close = () => {
    if (publishing.current) return
    generation.current++
    useCreationMaterialsStore.getState().close()
  }
  const add = async () => {
    if (pending.current || disabled) return
    const captured = ++generation.current
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const path = await pickFile({
        directory: false,
        multiple: false,
        title: t('creation.materials.add'),
      })
      if (!owns(captured) || typeof path !== 'string') return
      publishing.current = true
      setSaving(true)
      const result = await commands.addCreationMaterial(identity, path)
      if (!owns(captured)) return
      if (result.status === 'error') {
        setError(result.error)
        return
      }
      setMaterials(previous => [...previous, result.data])
      publishing.current = false
      setSaving(false)
      await view(result.data)
    } catch {
      if (owns(captured)) setError('storage')
    } finally {
      publishing.current = false
      if (owns(captured)) setSaving(false)
      if (owns(captured)) {
        pending.current = false
        setBusy(false)
      }
    }
  }
  const remove = async () => {
    if (!selected || pending.current || disabled) return
    const material = selected
    const captured = ++generation.current
    publishing.current = true
    setSaving(true)
    pending.current = true
    setBusy(true)
    setError(null)
    try {
      const result = await commands.removeCreationMaterial(
        identity,
        material.id
      )
      if (!owns(captured)) return
      if (result.status === 'error') {
        setError(result.error)
        return
      }
      setMaterials(previous =>
        previous.filter(entry => entry.id !== material.id)
      )
      setSelected(null)
      setPage(null)
      setText('')
      addButton.current?.focus()
    } catch {
      if (owns(captured)) setError('storage')
    } finally {
      publishing.current = false
      if (owns(captured)) {
        setSaving(false)
        pending.current = false
        setBusy(false)
      }
    }
  }

  return (
    <>
      <TooltipHint content={t('creation.materials.open')}>
        <button
          ref={trigger}
          type="button"
          className="creation-icon-button pnds-focus-ring"
          disabled={disabled}
          aria-label={t('creation.materials.open')}
          onClick={() => useCreationMaterialsStore.getState().open(identity)}
        >
          <FileText aria-hidden="true" />
        </button>
      </TooltipHint>
      <Dialog
        open={shown}
        onOpenChange={value => {
          if (!value) close()
        }}
      >
        <DialogContent
          showCloseButton={false}
          className="flex h-[min(85vh,42rem)] flex-col overflow-hidden sm:max-w-3xl"
          onCloseAutoFocus={event => {
            event.preventDefault()
            trigger.current?.focus()
          }}
        >
          <DialogHeader>
            <DialogTitle>{t('creation.materials.open')}</DialogTitle>
            <DialogDescription>
              {t('creation.materials.description')}
            </DialogDescription>
          </DialogHeader>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            className="absolute end-3 top-3"
            aria-label={t('settings.close')}
            aria-disabled={saving}
            onClick={close}
          >
            <X aria-hidden="true" />
          </Button>
          <div className="flex flex-wrap items-center gap-2">
            <Button
              ref={addButton}
              type="button"
              variant="outline"
              aria-disabled={busy || disabled}
              onClick={() => void add()}
            >
              {t('creation.materials.add')}
            </Button>
            {busy && (
              <span role="status" className="text-sm text-muted-foreground">
                {t('creation.materials.busy')}
              </span>
            )}
          </div>
          {error && (
            <div role="alert" className="text-sm text-(--pnds-danger)">
              {t(`creation.materials.error.${error}`)}
              <Button
                type="button"
                variant="ghost"
                aria-disabled={busy}
                onClick={() => {
                  if (!pending.current) void load()
                }}
              >
                {t('error.retry')}
              </Button>
            </div>
          )}
          <div className="grid min-h-0 flex-1 items-start gap-3 overflow-auto sm:grid-cols-[12rem_minmax(0,1fr)]">
            <div
              className="space-y-1"
              aria-label={t('creation.materials.list')}
            >
              {!materials.length && !busy && (
                <p className="text-sm text-muted-foreground">
                  {t('creation.materials.empty')}
                </p>
              )}
              {materials.map(material => (
                <button
                  key={material.id}
                  type="button"
                  className="pnds-focus-ring block w-full break-all rounded border px-3 py-2 text-start text-sm aria-pressed:bg-accent"
                  aria-pressed={selected?.id === material.id}
                  aria-disabled={busy}
                  onClick={() => {
                    if (!pending.current) void view(material)
                  }}
                >
                  {material.name}
                </button>
              ))}
            </div>
            {selected && (
              <section className="min-w-0 space-y-2" aria-label={selected.name}>
                <div className="flex items-center justify-between gap-2">
                  <strong className="break-all text-sm">{selected.name}</strong>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    aria-disabled={busy || disabled}
                    onClick={() => void remove()}
                  >
                    {t('creation.materials.remove')}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">
                  {t('creation.materials.removeHint')}
                </p>
                {page && (
                  <>
                    <p className="text-xs text-muted-foreground">
                      {t('creation.materials.range', {
                        end: page.endOffset,
                        total: page.totalCharacters,
                      })}
                    </p>
                    <pre
                      tabIndex={0}
                      aria-label={t('creation.materials.content')}
                      className="pnds-focus-ring max-h-[45vh] select-text overflow-auto whitespace-pre-wrap break-words rounded border p-3 font-mono text-xs [-webkit-user-select:text]"
                    >
                      {text}
                    </pre>
                    {page.nextOffset !== null && (
                      <Button
                        type="button"
                        variant="outline"
                        aria-disabled={busy}
                        onClick={() => {
                          if (!pending.current) void view(selected, true)
                        }}
                      >
                        {t('creation.materials.more')}
                      </Button>
                    )}
                  </>
                )}
              </section>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
