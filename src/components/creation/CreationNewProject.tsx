import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { open } from '@tauri-apps/plugin-dialog'
import { openUrl } from '@tauri-apps/plugin-opener'
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
import {
  creationTransportError,
  useCreationStore,
} from '@/store/creation-store'
import { commands, type CreationError } from '@/lib/tauri-bindings'
import { notifications } from '@/lib/notifications'
import { useCreationReadingStore } from '@/store/creation-reading-store'
import { loadPreferences } from '@/lib/preferences'
import { creationProjectFolderName } from '@/lib/creation-project-name'
import { cn } from '@/lib/utils'
import { CreationErrorNotice } from './CreationErrorNotice'
import {
  CreationGitHubAccount,
  GithubErrorNotice,
} from './CreationGitHubAccount'
import {
  refreshGithubAuth,
  setGithubAccount,
  unwrapGithub,
  useGithubAuth,
} from './creation-github-data'
import {
  suggestedRepositoryName,
  useRepositoryOwners,
  validRepositoryName,
} from './creation-new-repository'

export function CreationNewProject({
  onClose,
  onCloseAutoFocus,
  className,
}: {
  onClose: () => void
  onCloseAutoFocus?: (event: Event) => void
  className?: string
}) {
  const { t, i18n } = useTranslation()
  const [name, setName] = useState(t('creation.newProject.defaultName'))
  const [folderName, setFolderName] = useState(() =>
    creationProjectFolderName(t('creation.newProject.defaultName'))
  )
  const [folderEdited, setFolderEdited] = useState(false)
  const [author, setAuthor] = useState('')
  const [gitName, setGitName] = useState<string | null>(null)
  const [gitEmail, setGitEmail] = useState('')
  const [preferredGitName, setPreferredGitName] = useState('')
  const [description, setDescription] = useState('')
  const lastParent = useCreationStore(state => state.lastCreationParent)
  const [selectedParent, setSelectedParent] = useState<string | null>(null)
  const parent = selectedParent ?? lastParent ?? ''
  const [picking, setPicking] = useState(false)
  const [error, setError] = useState<CreationError | null>(null)
  const busy = useCreationStore(state => state.opening)
  const failure = useCreationStore(state => state.error)
  const { status: auth, error: authError } = useGithubAuth(true)
  const [visibility, setVisibility] = useState<'public' | 'private' | 'local'>(
    'public'
  )
  const [repositoryName, setRepositoryName] = useState<string | null>(null)
  const [selectedOwner, setSelectedOwner] = useState<{
    accountId: string
    owner: string
  } | null>(null)
  const [githubProblem, setGithubProblem] = useState<unknown>(null)
  const [uploading, setUploading] = useState(false)
  const [createdProject, setCreatedProject] = useState<{
    identity: string
    head: string
  } | null>(null)
  const [pendingUpload, setPendingUpload] = useState(false)
  const uploadConfigured = auth?.configured === true
  const account = auth?.account ?? null
  const catalog = useRepositoryOwners(
    uploadConfigured ? (account?.id ?? null) : null
  )
  const localOnly = !uploadConfigured || visibility === 'local'
  const owner =
    (selectedOwner && selectedOwner.accountId === account?.id
      ? selectedOwner.owner
      : account?.login) ?? ''
  const nameOnGitHub = (repositoryName ?? suggestedRepositoryName(name)).trim()
  const readyOnGitHub =
    !!account &&
    catalog.owners?.some(
      allowed => allowed.toLowerCase() === owner.toLowerCase()
    )
  const remoteNameValid = validRepositoryName(nameOnGitHub)
  const live = useRef(true)
  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
    }
  }, [])
  useEffect(() => {
    let live = true
    void loadPreferences().then(prefs => {
      if (live && prefs) setPreferredGitName(prefs.gitName?.trim() ?? '')
    })
    return () => {
      live = false
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
    : [...folderName].length > 64
      ? 'creation.newProject.folderError.length'
      : !/^[\p{L}\p{N}-]+$/u.test(folderName)
        ? 'creation.newProject.folderError.characters'
        : folderName.startsWith('-') || folderName.endsWith('-')
          ? 'creation.newProject.folderError.boundary'
          : null
  const validFolder = folderError === null
  const versionAuthor =
    gitName ?? (preferredGitName || author.trim() || 'PNDS Creator')
  const locked = busy || picking || uploading
  const localReady = !locked && !!parent && !!name.trim() && validFolder
  const authorizeInstallation = async (url: string) => {
    try {
      await openUrl(url)
      setGithubProblem(null)
    } catch (cause) {
      setGithubProblem(cause)
    }
  }
  const submit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    if ((!createdProject && !localReady) || locked || pendingUpload) return
    if (!localOnly && (!account || !readyOnGitHub || !remoteNameValid)) return
    const target =
      !localOnly && account
        ? {
            accountId: account.id,
            owner,
            name: nameOnGitHub,
            private: visibility === 'private',
          }
        : null
    setGithubProblem(null)
    let local = createdProject
    if (!local) {
      const success = await useCreationStore.getState().create({
        parent,
        folderName,
        name,
        author,
        gitName: versionAuthor,
        gitEmail,
        description,
        locale: i18n.resolvedLanguage ?? 'en',
      })
      if (!success || !live.current) return
      if (!target) {
        onClose()
        return
      }
      const workspace = useCreationStore.getState().workspace
      if (!workspace?.initialGitHead) {
        void notifications.error(t('creation.newProject.uploadIncomplete'))
        onClose()
        return
      }
      local = {
        identity: workspace.project.identity,
        head: workspace.initialGitHead,
      }
      setCreatedProject(local)
    }
    if (!target) {
      onClose()
      return
    }
    if (
      useCreationStore.getState().workspace?.project.identity !== local.identity
    )
      return
    setUploading(true)
    try {
      const status = unwrapGithub(
        await commands.githubUploadNewProject(
          local.identity,
          local.head,
          target
        )
      )
      if (
        !live.current ||
        useCreationStore.getState().workspace?.project.identity !==
          local.identity
      )
        return
      useCreationReadingStore.getState().gitChanged()
      void notifications.success(
        t('creation.newProject.uploadComplete', {
          repository:
            status.repository?.fullName ?? `${target.owner}/${target.name}`,
        })
      )
      onClose()
    } catch (cause) {
      if (!live.current) return
      if (
        useCreationStore.getState().workspace?.project.identity !==
        local.identity
      ) {
        onClose()
        return
      }
      setGithubProblem(cause)
      try {
        const status = unwrapGithub(
          await commands.githubSyncStatus(local.identity, false)
        )
        if (live.current)
          setPendingUpload(
            Boolean(status.initialUploadPending || status.templateBackupPending)
          )
      } catch {
        if (live.current) setPendingUpload(true)
      }
    } finally {
      if (live.current) setUploading(false)
    }
  }
  const openLocalWorkspace = () => {
    if (
      pendingUpload &&
      useCreationStore.getState().workspace?.project.identity ===
        createdProject?.identity
    )
      useCreationReadingStore.getState().showGit('status')
    onClose()
  }
  const submitLabel = localOnly
    ? 'creation.newProject.create'
    : visibility === 'private'
      ? 'creation.newProject.createPrivate'
      : 'creation.newProject.createPublic'
  return (
    <Dialog
      open
      onOpenChange={open => {
        if (!open && !locked) onClose()
      }}
    >
      <DialogContent
        showCloseButton={false}
        onCloseAutoFocus={onCloseAutoFocus}
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
            <label className="grid gap-1 text-sm">
              <span>{t('creation.newProject.name')}</span>
              <Input
                disabled={!!createdProject}
                required
                autoCorrect="off"
                autoCapitalize="none"
                spellCheck={false}
                maxLength={128}
                value={name}
                onChange={event => {
                  setName(event.target.value)
                  if (!folderEdited)
                    setFolderName(creationProjectFolderName(event.target.value))
                }}
              />
            </label>
            <div className="grid gap-1">
              <label htmlFor="creation-parent" className="text-sm">
                {t('creation.newProject.parent')}
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  id="creation-parent"
                  className="min-w-32 flex-1"
                  readOnly
                  value={parent}
                />
                <Button
                  type="button"
                  variant="outline"
                  disabled={!!createdProject}
                  onClick={() => void chooseParent()}
                >
                  {t('creation.newProject.chooseParent')}
                </Button>
              </div>
              {parent && (
                <p className="break-all text-xs text-muted-foreground">
                  {t('creation.newProject.target', {
                    path: `${parent.replace(/\/+$/, '')}/${folderName}`,
                  })}
                </p>
              )}
            </div>
            {folderError && (
              <small
                id="creation-folder-name-error"
                role="alert"
                className="text-(--pnds-danger)"
              >
                {t(folderError)}
              </small>
            )}
            {uploadConfigured && (
              <section className="grid gap-2 rounded-md border border-border p-3 text-sm">
                <div
                  aria-live="polite"
                  className="flex flex-wrap items-center justify-between gap-2"
                >
                  <span>
                    {localOnly ? t('creation.newProject.localOnly') : 'GitHub'}
                  </span>
                  {!localOnly && (
                    <>
                      <span className="break-all" dir="ltr">
                        {owner
                          ? `${owner}/${nameOnGitHub}`
                          : t('creation.newProject.unknownRepository')}
                      </span>
                      <span>
                        {t(`creation.newProject.visibility.${visibility}`)}
                      </span>
                    </>
                  )}
                </div>
                {!localOnly && !account && (
                  <CreationGitHubAccount
                    status={auth}
                    error={authError}
                    onRefresh={() => void refreshGithubAuth()}
                    onConnected={setGithubAccount}
                  />
                )}
                {!localOnly && account && !readyOnGitHub && (
                  <>
                    {catalog.error != null ? (
                      <GithubErrorNotice error={catalog.error} />
                    ) : catalog.owners === null ? (
                      <p role="status">{t('creation.loading')}</p>
                    ) : (
                      <p>{t('creation.newProject.permissionsNeeded')}</p>
                    )}
                    {(catalog.owners !== null || catalog.error != null) && (
                      <div className="flex flex-wrap gap-2">
                        {auth.installationUrl && (
                          <Button
                            type="button"
                            variant="outline"
                            onClick={() => {
                              if (auth.installationUrl)
                                void authorizeInstallation(auth.installationUrl)
                            }}
                          >
                            {t('creation.newProject.managePermission')}
                          </Button>
                        )}
                        <Button
                          type="button"
                          variant="outline"
                          onClick={() => void catalog.refresh()}
                        >
                          {t('creation.newProject.recheckPermission')}
                        </Button>
                      </div>
                    )}
                  </>
                )}
              </section>
            )}
            <details
              className="creation-details"
              onInvalidCapture={event => {
                event.currentTarget.open = true
              }}
            >
              <summary className="pnds-focus-ring">
                {t('creation.newProject.moreOptions')}
              </summary>
              <div className="grid gap-4">
                {uploadConfigured && (
                  <fieldset className="grid gap-2">
                    <legend className="text-sm">
                      {t('creation.newProject.repositoryVisibility')}
                    </legend>
                    <div className="flex flex-wrap gap-3">
                      {(['public', 'private', 'local'] as const).map(option => (
                        <label
                          key={option}
                          className="flex items-center gap-1.5 text-sm"
                        >
                          <input
                            type="radio"
                            name="creation-repository-visibility"
                            value={option}
                            checked={visibility === option}
                            onChange={() => setVisibility(option)}
                          />
                          {t(`creation.newProject.visibility.${option}`)}
                        </label>
                      ))}
                    </div>
                    {!localOnly && (
                      <>
                        {account && (
                          <div className="grid gap-1 text-sm">
                            <label htmlFor="creation-repository-owner">
                              {t('creation.newProject.repositoryOwner')}
                            </label>
                            <Select
                              dir="ltr"
                              disabled={locked || pendingUpload}
                              value={owner}
                              onValueChange={owner =>
                                setSelectedOwner({
                                  accountId: account.id,
                                  owner,
                                })
                              }
                            >
                              <SelectTrigger
                                id="creation-repository-owner"
                                className="w-full"
                              >
                                <SelectValue />
                              </SelectTrigger>
                              <SelectContent>
                                {Array.from(
                                  new Set([
                                    account.login,
                                    ...(catalog.owners ?? []),
                                    owner,
                                  ])
                                ).map(login => (
                                  <SelectItem key={login} value={login}>
                                    {login}
                                  </SelectItem>
                                ))}
                              </SelectContent>
                            </Select>
                          </div>
                        )}
                        <label className="grid gap-1 text-sm">
                          <span>{t('creation.newProject.repositoryName')}</span>
                          <Input
                            dir="ltr"
                            autoCapitalize="none"
                            autoCorrect="off"
                            spellCheck={false}
                            maxLength={100}
                            aria-invalid={!remoteNameValid}
                            value={
                              repositoryName ?? suggestedRepositoryName(name)
                            }
                            onChange={event =>
                              setRepositoryName(event.target.value)
                            }
                          />
                        </label>
                      </>
                    )}
                  </fieldset>
                )}
                <label className="grid gap-1 text-sm">
                  <span>{t('creation.newProject.folderName')}</span>
                  <Input
                    disabled={!!createdProject}
                    required
                    autoCorrect="off"
                    autoCapitalize="none"
                    spellCheck={false}
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
                    onChange={event => {
                      setFolderEdited(true)
                      setFolderName(event.target.value.toLowerCase())
                    }}
                  />
                  <small id="creation-folder-name-hint">
                    {t('creation.newProject.folderHint')}
                  </small>
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t('creation.newProject.author')}</span>
                  <Input
                    disabled={!!createdProject}
                    maxLength={128}
                    value={author}
                    onChange={event => setAuthor(event.target.value)}
                  />
                </label>
                <label className="grid gap-1 text-sm">
                  <span>{t('creation.newProject.description')}</span>
                  <textarea
                    disabled={!!createdProject}
                    className="creation-editor-textarea pnds-focus-ring min-h-20"
                    maxLength={4096}
                    value={description}
                    onChange={event => setDescription(event.target.value)}
                  />
                </label>
                <fieldset
                  disabled={!!createdProject}
                  className="grid gap-2 rounded border border-border p-3"
                >
                  <legend className="text-sm">
                    {t('creation.version.initial')}
                  </legend>
                  <p className="text-xs">{t('creation.version.newScope')}</p>
                  <label className="grid gap-1 text-sm">
                    <span>{t('creation.version.name')}</span>
                    <Input
                      required
                      maxLength={128}
                      value={versionAuthor}
                      onChange={event => setGitName(event.target.value)}
                    />
                  </label>
                  <label className="grid gap-1 text-sm">
                    <span>{t('creation.version.email')}</span>
                    <Input
                      type="email"
                      aria-describedby="creation-commit-email-hint"
                      maxLength={254}
                      value={gitEmail}
                      onChange={event => setGitEmail(event.target.value)}
                    />
                  </label>
                  <p id="creation-commit-email-hint" className="text-xs">
                    {t('creation.newProject.commitEmailHint')}
                  </p>
                </fieldset>
                <div className="grid gap-1 rounded-md border border-border p-3 text-sm">
                  <span>{t('creation.newProject.blank.name')}</span>
                  <span className="text-xs text-muted-foreground">
                    {t('creation.newProject.blank.description')}
                  </span>
                  <span className="text-xs">
                    {t('creation.newProject.blank.source')}
                  </span>
                  <p className="text-xs">
                    {t('creation.newProject.audioHint')}
                  </p>
                </div>
              </div>
            </details>
          </fieldset>
          {(error || failure) && (
            <CreationErrorNotice error={(error ?? failure) as CreationError} />
          )}
          {githubProblem != null && <GithubErrorNotice error={githubProblem} />}
          {pendingUpload && (
            <p role="status">{t('creation.newProject.uploadIncomplete')}</p>
          )}
          {createdProject && !pendingUpload && !uploading && (
            <p role="status">{t('creation.newProject.localCreated')}</p>
          )}
          {locked && (
            <p role="status">
              {t(
                picking
                  ? 'creation.newProject.choosing'
                  : uploading
                    ? 'creation.newProject.uploading'
                    : 'creation.newProject.creating'
              )}
            </p>
          )}
          <DialogFooter>
            {!localOnly && !readyOnGitHub && !pendingUpload && (
              <Button
                type="button"
                variant="outline"
                disabled={!localReady && !createdProject}
                onClick={() => setVisibility('local')}
              >
                {t('creation.newProject.localFirst')}
              </Button>
            )}
            <Button
              type="button"
              variant="outline"
              disabled={locked}
              onClick={openLocalWorkspace}
            >
              {t(
                createdProject
                  ? 'creation.newProject.openCreated'
                  : 'creation.cancel'
              )}
            </Button>
            {!pendingUpload && (
              <Button
                type="submit"
                disabled={
                  locked ||
                  (!createdProject && !localReady) ||
                  (!localOnly && (!readyOnGitHub || !remoteNameValid))
                }
              >
                {t(
                  createdProject && !localOnly
                    ? 'creation.newProject.tryUpload'
                    : submitLabel
                )}
              </Button>
            )}
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
