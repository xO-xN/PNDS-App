import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
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
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import type { CreationError } from '@/lib/tauri-bindings'
import { cn } from '@/lib/utils'
import { CreationErrorNotice } from './CreationErrorNotice'

export function CreationNewProject({
  onClose,
  className,
}: {
  onClose: () => void
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const [name, setName] = useState(t('creation.newProject.defaultName'))
  const [folderName, setFolderName] = useState('untitled-score')
  const [author, setAuthor] = useState('')
  const [description, setDescription] = useState('')
  const lastParent = useCreationStore(state => state.lastCreationParent)
  const [selectedParent, setSelectedParent] = useState<string | null>(null)
  const parent = selectedParent ?? lastParent ?? ''
  const [template, setTemplate] = useState<'blank' | 'classic'>('blank')
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<CreationError | null>(null)
  const busy = useCreationStore(state => state.opening)
  const failure = useCreationStore(state => state.error)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  const chooseParent = async () => {
    setPicking(true)
    setError(null)
    const identity = useCreationStore.getState().workspace?.project.identity
    const epoch = useCreationStore.getState().epoch
    const owns = () =>
      live.current &&
      useCreationStore.getState().active &&
      useCreationStore.getState().workspace?.project.identity === identity &&
      useCreationStore.getState().epoch === epoch
    try {
      const selected = await open({
        directory: true,
        multiple: false,
        title: t('creation.newProject.chooseParent'),
      })
      if (owns() && typeof selected === 'string') {
        setSelectedParent(selected)
        useCreationStore.getState().rememberCreationParent(selected)
      }
    } catch (error) {
      if (owns()) setError(creationTransportError(error))
    } finally {
      if (live.current) setPicking(false)
    }
  }
  const folderError = !folderName
    ? 'creation.newProject.folderError.required'
    : folderName.length > 64
      ? 'creation.newProject.folderError.length'
      : !/^[a-z0-9-]+$/.test(folderName)
        ? 'creation.newProject.folderError.characters'
        : folderName.startsWith('-') || folderName.endsWith('-')
          ? 'creation.newProject.folderError.boundary'
          : null
  const validFolder = folderError === null
  const locked = busy || picking
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (locked || !name.trim() || !validFolder || !parent) return
    const success = await useCreationStore.getState().create({
      ...(template === 'classic' ? { template } : {}),
      parent,
      folderName,
      name,
      author,
      description,
      locale: i18n.resolvedLanguage ?? 'en',
    })
    if (success && live.current) onClose()
  }
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !locked) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className={cn('max-h-[85vh] overflow-auto', className)}
      >
        <DialogHeader>
          <DialogTitle>{t('creation.newProject.title')}</DialogTitle>
          <DialogDescription>{t('creation.newProject.hint')}</DialogDescription>
        </DialogHeader>
        <form
          onSubmit={event => void submit(event)}
          className="grid gap-4 text-start"
        >
          <fieldset disabled={locked} className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="mb-2 text-sm">
                {t('creation.newProject.template')}
              </legend>
              {(['blank', 'classic'] as const).map(item => (
                <label
                  key={item}
                  className="grid gap-1 rounded-md border border-border p-3 text-sm has-[:checked]:border-primary"
                >
                  <span className="flex items-center gap-2">
                    <input
                      type="radio"
                      name="template"
                      value={item}
                      checked={template === item}
                      onChange={() => setTemplate(item)}
                      className="pnds-focus-ring"
                    />
                    {t(`creation.newProject.${item}.name`)}
                  </span>
                  <span className="text-xs text-muted-foreground">
                    {t(`creation.newProject.${item}.description`)}
                  </span>
                  <span className="text-xs">
                    {t(`creation.newProject.${item}.source`)}
                  </span>
                </label>
              ))}
            </fieldset>
            <label className="grid gap-1 text-sm">
              <span>{t('creation.newProject.name')}</span>
              <Input
                required
                maxLength={128}
                value={name}
                onChange={event => setName(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t('creation.newProject.folderName')}</span>
              <Input
                required
                dir="ltr"
                aria-label={t('creation.newProject.folderName')}
                maxLength={64}
                value={folderName}
                aria-invalid={!validFolder}
                aria-describedby={
                  folderError
                    ? 'creation-folder-name-hint creation-folder-name-error'
                    : 'creation-folder-name-hint'
                }
                onChange={event =>
                  setFolderName(
                    event.target.value.replace(/[A-Z]/g, letter =>
                      letter.toLowerCase()
                    )
                  )
                }
              />
              <small id="creation-folder-name-hint">
                {t('creation.newProject.folderHint')}
              </small>
              {folderError && (
                <small
                  id="creation-folder-name-error"
                  role="alert"
                  className="text-(--pnds-danger)"
                >
                  {t(folderError)}
                </small>
              )}
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t('creation.newProject.author')}</span>
              <Input
                maxLength={128}
                value={author}
                onChange={event => setAuthor(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t('creation.newProject.description')}</span>
              <textarea
                className="creation-editor-textarea pnds-focus-ring min-h-20"
                maxLength={4096}
                value={description}
                onChange={event => setDescription(event.target.value)}
              />
            </label>
            <label className="grid gap-1 text-sm">
              <span>{t('creation.newProject.parent')}</span>
              <Input readOnly value={parent} />
            </label>
            <Button
              type="button"
              variant="outline"
              onClick={() => void chooseParent()}
            >
              {t('creation.newProject.chooseParent')}
            </Button>
            {parent && (
              <p className="break-all text-xs">
                {t('creation.newProject.target', {
                  path: `${parent}/${folderName}`,
                })}
              </p>
            )}
          </fieldset>
          <p className="text-xs">
            {t(
              template === 'classic'
                ? 'creation.newProject.classic.audioHint'
                : 'creation.newProject.audioHint'
            )}
          </p>
          {(error || failure) && (
            <CreationErrorNotice error={(error ?? failure) as CreationError} />
          )}
          {locked && (
            <p role="status">
              {t(
                picking
                  ? 'creation.newProject.choosing'
                  : 'creation.newProject.creating'
              )}
            </p>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={onClose}
            >
              {t('creation.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={locked || !parent || !name.trim() || !validFolder}
            >
              {t('creation.newProject.create')}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
