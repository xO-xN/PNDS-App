import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isProtectedFolder, useProjectStore } from '@/store/project-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PreflightDock } from '@/components/shell/PreflightDock'

/**
 * v1.5.0 (#124): the folder's self-written intro (文件夹自述) in the main
 * area. The folder resolves live from the store by id, so an intro save
 * or a rename elsewhere re-renders this panel without any prop wiring;
 * a vanished folder (deleted while drilled in — the store exits the view
 * anyway) renders nothing. Since #125 the README routing mounts this
 * for EVERY drilled-in folder, protected ones included — protected
 * folders (Utilities) render no edit entry (the store guard behind it
 * refuses writes all the same).
 *
 * The form edits both fields (user report after #124: the name box was
 * read-only and read as broken): the name commits through the same
 * `renameFolder` seam as the sidebar's inline ⌘R — the uniqueness and
 * protected-folder guards apply unchanged, a refused or blank name
 * keeps the form open with its reason and saves nothing — and the
 * multi-line intro through `setFolderIntro`; both persist with the
 * index like every structural commit. The bottom dock keeps the
 * main-area preflight feedback.
 */
export function FolderReadme({ folderId }: { folderId: string }) {
  const { t } = useTranslation()
  const nameFieldId = useId()
  const introFieldId = useId()
  // null = display mode; an object is the in-edit draft (name + intro).
  const [draft, setDraft] = useState<{ name: string; intro: string } | null>(
    null
  )
  // The refused-name reason line under the name field (blank or taken).
  const [nameError, setNameError] = useState(false)
  const folder = useProjectStore(state =>
    state.projectFolders.find(folder => folder.id === folderId)
  )

  if (!folder) return null

  const editing = draft !== null
  const editable = !isProtectedFolder(folder.id)

  const startEditing = () => {
    setDraft({ name: folder.name, intro: folder.intro ?? '' })
    setNameError(false)
  }

  const saveDraft = () => {
    // The save button only renders in edit mode; the guard keeps a stray
    // call (draft already reset) from clearing the stored intro.
    if (draft === null) return
    const nextName = draft.name.trim()
    if (nextName === '') {
      setNameError(true)
      return
    }
    // getState() in the handler (never a render-path read): the actions
    // travel with the store, the identity with the closure. The rename
    // runs the sidebar's own guards; a refusal (duplicate name — a
    // protected folder cannot reach this form) keeps the form open with
    // the reason and commits nothing.
    const { setFolderIntro, renameFolder } = useProjectStore.getState()
    if (nextName !== folder.name && !renameFolder(folder.id, nextName)) {
      setNameError(true)
      return
    }
    setFolderIntro(folder.id, draft.intro)
    setDraft(null)
  }

  return (
    <div
      data-testid="folder-readme"
      className="relative flex min-h-full flex-col bg-(--pnds-bg) p-8 animate-[fade-in_0.8s_ease-in]"
    >
      <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
        <header className="flex items-start justify-between gap-4">
          <h1 className="text-[32px] font-light leading-tight tracking-wide text-(--pnds-text)">
            {folder.name}
          </h1>
          {editable && !editing && (
            <Button
              variant="outline"
              size="sm"
              className="shrink-0"
              onClick={startEditing}
            >
              {t('folderReadme.edit')}
            </Button>
          )}
        </header>

        {editing ? (
          <form
            data-testid="folder-readme-form"
            className="mt-6 flex flex-col gap-5"
            onSubmit={event => {
              event.preventDefault()
              saveDraft()
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor={nameFieldId}>{t('folderReadme.nameLabel')}</Label>
              {/* The name commits through renameFolder — the same guards
                  as the sidebar's inline ⌘R apply on save. */}
              <Input
                id={nameFieldId}
                value={draft.name}
                onChange={event => {
                  setDraft({ ...draft, name: event.target.value })
                  setNameError(false)
                }}
                autoComplete="off"
                spellCheck={false}
                dir="auto"
              />
              {nameError && (
                <p role="alert" className="text-sm text-(--pnds-danger)">
                  {draft.name.trim() === ''
                    ? t('folderReadme.nameInvalid')
                    : t('sidebar.folderNameTaken', { name: draft.name.trim() })}
                </p>
              )}
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={introFieldId}>
                {t('folderReadme.introLabel')}
              </Label>
              <Textarea
                id={introFieldId}
                value={draft.intro}
                onChange={event =>
                  setDraft({ ...draft, intro: event.target.value })
                }
                placeholder={t('folderReadme.introPlaceholder')}
                rows={6}
                className="resize-y field-sizing-fixed"
                dir="auto"
              />
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setDraft(null)}
              >
                {t('folderReadme.cancel')}
              </Button>
              <Button type="submit">{t('folderReadme.save')}</Button>
            </div>
          </form>
        ) : folder.intro ? (
          <p className="font-manrope mt-6 whitespace-pre-wrap text-start text-[15px] leading-7 text-(--pnds-text)/80">
            {folder.intro}
          </p>
        ) : (
          <p className="mt-6 text-[15px] text-(--pnds-text)/50">
            {editable
              ? t('folderReadme.empty')
              : t('folderReadme.emptyProtected')}
          </p>
        )}
      </div>

      {/* Same bottom-docked preflight feedback as the starting page —
          drilled into a folder, a check's Checking…/error stays visible. */}
      <PreflightDock />
    </div>
  )
}
