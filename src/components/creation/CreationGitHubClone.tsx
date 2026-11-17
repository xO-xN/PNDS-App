import { useEffect, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
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
import { notifications } from '@/lib/notifications'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import {
  CreationGitHubAccount,
  GithubErrorNotice,
} from './CreationGitHubAccount'
import { CreationGitHubRepositoryField } from './CreationGitHubRepositoryField'
import { CreationErrorNotice } from './CreationErrorNotice'
import {
  githubErrorKey,
  refreshGithubAuth,
  setGithubAccount,
  unwrapGithub,
  useGithubAuth,
  useGithubRepositories,
} from './creation-github-data'
import './creation-github.css'

export function CreationGitHubClone({
  onClose,
  onCloseAutoFocus,
}: {
  onClose: () => void
  onCloseAutoFocus: (event: Event) => void
}) {
  const { t } = useTranslation()
  const { status, error: authError } = useGithubAuth(true)
  const [publicMode, setPublicMode] = useState(false)
  const [publicName, setPublicName] = useState('')
  const [publicSource, setPublicSource] = useState('')
  const [repositoryId, setRepositoryId] = useState('')
  const [branchSelection, setBranchSelection] = useState<{
    source: string
    name: string
  } | null>(null)
  const [branchRevision, setBranchRevision] = useState(0)
  const [branches, setBranches] = useState<{
    source: string
    revision: number
    values: string[] | null
    error: unknown
  } | null>(null)
  const [selectedParent, setSelectedParent] = useState<string | null>(null)
  const lastParent = useCreationStore(state => state.lastCreationParent)
  const openError = useCreationStore(state => state.error)
  const [editedFolder, setEditedFolder] = useState<string | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [picking, setPicking] = useState(false)
  const [busy, setBusy] = useState(false)
  const [published, setPublished] = useState<{
    path: string
    warning: unknown
  } | null>(null)
  const live = useRef(true)
  const operation = useRef(false)
  const pendingToast = useRef(false)
  const toastId = `creation-github-clone:${useId()}`
  const branchId = useId()
  const catalog = useGithubRepositories(
    publicMode ? null : (status?.account?.id ?? null)
  )
  const repository = catalog.repositories?.find(
    item => item.id === repositoryId
  )
  const source = publicMode ? publicSource : (repository?.fullName ?? '')
  const loaded =
    branches &&
    branches.source === source &&
    branches.revision === branchRevision
      ? branches
      : null
  const defaultBranch =
    !publicMode && loaded?.values?.includes(repository?.defaultBranch ?? '')
      ? repository?.defaultBranch
      : undefined
  const branch =
    branchSelection &&
    branchSelection.source === source &&
    loaded?.values?.includes(branchSelection.name)
      ? branchSelection.name
      : (defaultBranch ?? '')
  const parent = selectedParent ?? lastParent ?? ''
  const folderInput = editedFolder ?? source.split('/').at(-1) ?? ''
  const folder = folderInput.trim()
  const validFolder =
    Boolean(folder) &&
    !/^[.]|[/\\\p{Cc}]/u.test(folder) &&
    new TextEncoder().encode(folder).length <= 120
  const validPublicName = /^[a-z\d-]+\/[a-z\d_.-]+$/i.test(publicName.trim())

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      if (pendingToast.current) notifications.flow.dismiss(toastId)
    }
  }, [toastId])
  useEffect(() => {
    if (!source) return
    let current = true
    void (async () => {
      try {
        const values = unwrapGithub(await commands.githubListBranches(source))
        if (current)
          setBranches({ source, revision: branchRevision, values, error: null })
      } catch (cause) {
        if (current)
          setBranches({
            source,
            revision: branchRevision,
            values: null,
            error: cause,
          })
      }
    })()
    return () => {
      current = false
    }
  }, [source, branchRevision])

  const workspaceOwner = () => {
    const { epoch, workspace } = useCreationStore.getState()
    return () => {
      const current = useCreationStore.getState()
      return (
        live.current &&
        current.active &&
        current.epoch === epoch &&
        current.workspace?.project.identity === workspace?.project.identity
      )
    }
  }
  const pickParent = async () => {
    const owns = workspaceOwner()
    setError(null)
    setPicking(true)
    try {
      const value = await open({
        directory: true,
        multiple: false,
        title: t('creation.newProject.chooseParent'),
      })
      if (owns() && typeof value === 'string') {
        setSelectedParent(value)
        useCreationStore.getState().rememberCreationParent(value)
      }
    } catch (cause) {
      if (owns()) setError(cause)
    } finally {
      if (live.current) setPicking(false)
    }
  }
  const clone = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if (
      operation.current ||
      picking ||
      (!published && (!source || !branch || !parent || !validFolder))
    )
      return
    const owns = workspaceOwner()
    if (!owns()) return
    operation.current = true
    pendingToast.current = true
    setBusy(true)
    setError(null)
    notifications.flow.step(
      toastId,
      t(published ? 'creation.github.openingClone' : 'creation.github.cloning')
    )
    try {
      const result =
        published ??
        unwrapGithub(
          await commands.githubCloneRepository(source, branch, parent, folder)
        )
      if (!owns()) return
      setPublished(result)
      notifications.flow.step(toastId, t('creation.github.openingClone'))
      const opened = await useCreationStore.getState().open(result.path)
      if (
        opened &&
        useCreationStore.getState().workspace?.project.root === result.path
      ) {
        pendingToast.current = false
        if (live.current) onClose()
        if (result.warning)
          notifications.flow.warn(
            toastId,
            t('creation.github.cloneOpened'),
            t(githubErrorKey(result.warning))
          )
        else
          notifications.flow.succeed(toastId, t('creation.github.cloneOpened'))
      } else if (owns()) {
        pendingToast.current = false
        notifications.flow.warn(
          toastId,
          t('creation.github.clonePublished', { path: result.path })
        )
      }
    } catch (cause) {
      if (owns()) {
        setError(cause)
        pendingToast.current = false
        notifications.flow.fail(toastId, t('creation.github.cloneFailed'))
      }
    } finally {
      if (pendingToast.current) {
        pendingToast.current = false
        notifications.flow.dismiss(toastId)
      }
      operation.current = false
      if (live.current) setBusy(false)
    }
  }

  return (
    <Dialog
      open
      onOpenChange={value => {
        if (!value && !busy && !picking) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        className="max-h-[85vh] overflow-auto"
        onCloseAutoFocus={onCloseAutoFocus}
      >
        <DialogHeader>
          <DialogTitle>{t('creation.github.clone')}</DialogTitle>
          <DialogDescription>
            {t('creation.github.cloneHint')}
          </DialogDescription>
        </DialogHeader>
        <form
          className="grid gap-4 text-start"
          onSubmit={event => void clone(event)}
        >
          {error !== null && <GithubErrorNotice error={error} />}
          {published ? (
            <>
              <p role="status" className="break-words text-sm">
                {t('creation.github.clonePublished', { path: published.path })}
              </p>
              {openError && <CreationErrorNotice error={openError} />}
            </>
          ) : (
            <fieldset className="grid gap-4" disabled={busy || picking}>
              <div
                className="flex flex-wrap gap-2"
                aria-label={t('creation.github.repositorySource')}
                role="group"
              >
                <Button
                  type="button"
                  size="sm"
                  variant={publicMode ? 'outline' : 'secondary'}
                  aria-pressed={!publicMode}
                  onClick={() => setPublicMode(false)}
                >
                  {t('creation.github.authorizedRepositories')}
                </Button>
                <Button
                  type="button"
                  size="sm"
                  variant={publicMode ? 'secondary' : 'outline'}
                  aria-pressed={publicMode}
                  onClick={() => setPublicMode(true)}
                >
                  {t('creation.github.publicRepository')}
                </Button>
              </div>
              {publicMode ? (
                <div className="grid gap-2">
                  <label className="grid gap-1 text-sm">
                    {t('creation.github.publicName')}
                    <Input
                      dir="ltr"
                      placeholder="owner/repository"
                      value={publicName}
                      autoCorrect="off"
                      spellCheck={false}
                      onChange={event => {
                        setPublicName(event.currentTarget.value)
                        setPublicSource('')
                      }}
                    />
                  </label>
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!validPublicName}
                    onClick={() => {
                      setPublicSource(publicName.trim())
                      setBranchRevision(value => value + 1)
                    }}
                  >
                    {t('creation.github.findBranches')}
                  </Button>
                </div>
              ) : status?.account ? (
                <CreationGitHubRepositoryField
                  auth={status}
                  catalog={catalog}
                  repositories={catalog.repositories ?? []}
                  selected={repositoryId}
                  onSelect={setRepositoryId}
                />
              ) : (
                <CreationGitHubAccount
                  status={status}
                  error={authError}
                  onRefresh={() => void refreshGithubAuth()}
                  onConnected={setGithubAccount}
                />
              )}
              {source && (
                <>
                  {loaded?.error != null ? (
                    <div className="grid gap-2">
                      <GithubErrorNotice error={loaded.error} />
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => setBranchRevision(value => value + 1)}
                      >
                        {t('creation.github.retry')}
                      </Button>
                    </div>
                  ) : loaded?.values?.length ? (
                    <div className="grid gap-1 text-sm">
                      <label htmlFor={branchId}>
                        {t('creation.github.branch')}
                      </label>
                      <Select
                        value={branch}
                        onValueChange={name =>
                          setBranchSelection({ source, name })
                        }
                      >
                        <SelectTrigger id={branchId} className="w-full">
                          <SelectValue
                            placeholder={t('creation.github.selectBranch')}
                          />
                        </SelectTrigger>
                        <SelectContent>
                          {loaded.values.map(value => (
                            <SelectItem key={value} value={value} dir="ltr">
                              {value}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  ) : (
                    <p role="status" className="text-sm text-muted-foreground">
                      {t(
                        loaded?.values
                          ? 'creation.github.noBranches'
                          : 'creation.github.loadingBranches'
                      )}
                    </p>
                  )}
                </>
              )}
              {branch && (
                <>
                  <label className="grid gap-1 text-sm">
                    {t('creation.newProject.folderName')}
                    <Input
                      dir="ltr"
                      autoCorrect="off"
                      spellCheck={false}
                      maxLength={120}
                      value={folderInput}
                      onChange={event =>
                        setEditedFolder(event.currentTarget.value)
                      }
                      aria-invalid={!validFolder}
                      aria-describedby={
                        !validFolder
                          ? 'creation-github-folder-error'
                          : undefined
                      }
                    />
                  </label>
                  {!validFolder && (
                    <p
                      id="creation-github-folder-error"
                      className="text-sm text-(--pnds-danger)"
                    >
                      {t('creation.github.invalidFolder')}
                    </p>
                  )}
                  <label className="grid gap-1 text-sm">
                    {t('creation.newProject.parent')}
                    <Input dir="ltr" readOnly value={parent} />
                  </label>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void pickParent()}
                  >
                    {t('creation.newProject.chooseParent')}
                  </Button>
                  {parent && validFolder && (
                    <p className="break-all text-xs">
                      {t('creation.newProject.target', {
                        path: `${parent}/${folder}`,
                      })}
                    </p>
                  )}
                </>
              )}
            </fieldset>
          )}
          <DialogFooter>
            <Button
              type="button"
              variant="outline"
              disabled={busy || picking}
              onClick={onClose}
            >
              {t('creation.cancel')}
            </Button>
            <Button
              type="submit"
              disabled={
                busy ||
                picking ||
                (!published && (!source || !branch || !parent || !validFolder))
              }
            >
              {t(
                published
                  ? 'creation.github.openClone'
                  : 'creation.github.cloneAndOpen'
              )}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
