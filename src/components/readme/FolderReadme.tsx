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
 * folders (Utilities) render no edit entry and carry the App's fixed
 * one-line description instead of the empty hint (the store guard
 * behind the form refuses writes all the same).
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
      className="@container relative flex min-h-full flex-col bg-(--pnds-bg) p-8 animate-[fade-in_0.8s_ease-in]"
    >
      {editing ? (
        // The edit form keeps its working shape from #124 (both fields,
        // the rename guards, the refusal reason) — only the display mode
        // below took the cover-page styling (v1.5.0 polish, user
        // request: 参考工程的信息介绍，只要 title 与其下侧的描述).
        <div className="mx-auto flex w-full max-w-2xl flex-1 flex-col">
          <h1 className="text-[32px] font-light leading-tight tracking-wide text-(--pnds-text)">
            {folder.name}
          </h1>
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
        </div>
      ) : (
        // The display mode borrows the cover page's composition minus
        // everything the folder does not have (user spec): no PNDS /
        // composer header, no band rectangle, no cover image — just the
        // folder's name as the big centered title and its description
        // below. The name wraps (folders are not one-word titles), so
        // it takes a moderate tracking and a fitting clamp instead of
        // the cover title's nowrap fit machinery.
        <div className="flex flex-1 flex-col items-center justify-center px-8 pb-16">
          <h1
            dir="auto"
            className="w-full text-center text-[clamp(36px,7cqw,76px)] font-bold leading-[1.15] tracking-[0.12em] break-words text-(--pnds-text)"
          >
            {folder.name}
          </h1>
          {editable && (
            <Button
              variant="outline"
              size="sm"
              className="mt-10 shrink-0"
              onClick={startEditing}
            >
              {t('folderReadme.edit')}
            </Button>
          )}
          {folder.intro ? (
            <p
              dir="auto"
              className="font-manrope mt-10 max-w-xl whitespace-pre-wrap text-start text-[15px] leading-7 text-(--pnds-text)/80"
            >
              {folder.intro}
            </p>
          ) : (
            <p className="mt-10 max-w-xl text-center text-[15px] leading-7 text-(--pnds-text)/80">
              {/* The protected Utilities folder carries a fixed App
                  description (not the editable empty hint) — one line
                  saying what lives here (v1.5.0 polish, user copy). */}
              {!editable
                ? t('folderReadme.utilitiesIntro')
                : t('folderReadme.empty')}
            </p>
          )}
        </div>
      )}

      {/* Same bottom-docked preflight feedback as the starting page —
          drilled into a folder, a check's Checking…/error stays visible. */}
      <PreflightDock />
    </div>
  )
}
