import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { isProtectedFolder, useProjectStore } from '@/store/project-store'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Textarea } from '@/components/ui/textarea'
import { PreflightStatusBoxes } from '@/components/shell/PreflightStatusBoxes'

/**
 * v1.5.0 (#124): the folder's self-written intro (文件夹自述) in the main
 * area. The folder resolves live from the store by id, so an intro save
 * or a rename elsewhere re-renders this panel without any prop wiring;
 * a vanished folder (deleted while drilled in — the store exits the view
 * anyway) renders nothing. AppShell mounts this for the drilled-in,
 * self-created folder; protected folders (Utilities) render no edit
 * entry (the store guard behind it refuses writes all the same). The
 * form's fields are the spec's minimal set: the folder name, brought
 * along automatically and read-only (renaming stays a sidebar concern),
 * and the multi-line intro. Save commits through the store's structural
 * action, so persistence rides the same commit as every folder edit.
 * The bottom dock keeps the main-area preflight feedback (the display
 * routing in #125 keeps this coexistence).
 */
export function FolderReadme({ folderId }: { folderId: string }) {
  const { t } = useTranslation()
  const nameFieldId = useId()
  const introFieldId = useId()
  // null = display mode; a string is the in-edit draft of the intro.
  const [draft, setDraft] = useState<string | null>(null)
  const folder = useProjectStore(state =>
    state.projectFolders.find(folder => folder.id === folderId)
  )

  if (!folder) return null

  const editing = draft !== null
  const editable = !isProtectedFolder(folder.id)

  const startEditing = () => {
    setDraft(folder.intro ?? '')
  }

  const saveIntro = () => {
    // The save button only renders in edit mode; the guard keeps a stray
    // call (draft already reset) from clearing the stored intro.
    if (draft === null) return
    // getState() in the handler (never a render-path read): the action
    // travels with the store, the identity with the closure.
    useProjectStore.getState().setFolderIntro(folder.id, draft)
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
              saveIntro()
            }}
          >
            <div className="flex flex-col gap-2">
              <Label htmlFor={nameFieldId}>{t('folderReadme.nameLabel')}</Label>
              {/* The name is brought along automatically and read-only —
                  renaming a folder stays with the sidebar's inline ⌘R. */}
              <Input
                id={nameFieldId}
                value={folder.name}
                readOnly
                autoComplete="off"
                spellCheck={false}
                dir="auto"
              />
            </div>
            <div className="flex flex-col gap-2">
              <Label htmlFor={introFieldId}>
                {t('folderReadme.introLabel')}
              </Label>
              <Textarea
                id={introFieldId}
                value={draft ?? ''}
                onChange={event => setDraft(event.target.value)}
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
      <div className="absolute inset-x-8 bottom-8 flex flex-col items-center gap-2">
        <PreflightStatusBoxes />
      </div>
    </div>
  )
}
