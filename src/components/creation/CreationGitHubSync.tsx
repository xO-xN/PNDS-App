import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Cloud, ExternalLink, RefreshCw } from 'lucide-react'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Button } from '@/components/ui/button'
import { Switch } from '@/components/ui/switch'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { notifications } from '@/lib/notifications'
import {
  commands,
  type GithubPushPlan,
  type GithubRepository,
} from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useSettingsStore } from '@/store/settings-store'
import { GithubErrorNotice } from './CreationGitHubAccount'
import { CreationGitHubBind } from './CreationGitHubBind'
import { CreationGitHubPublicDirectory } from './CreationGitHubPublicDirectory'
import { CreationGitHubTemplateBackup } from './CreationGitHubTemplateBackup'
import {
  githubErrorKey,
  unwrapGithub,
  useGithubAuth,
  type GithubSyncStatus,
  type GithubTemplateBackupPlan,
  type GithubTemplateBackupTarget,
} from './creation-github-data'
import './creation-github.css'

type UpdateTarget = Parameters<typeof commands.githubUpdate>[1]
type InitialPending = NonNullable<GithubSyncStatus['initialUploadPending']>
type InitialReview = Extract<
  Awaited<ReturnType<typeof commands.githubPrepareInitialUpload>>,
  { status: 'ok' }
>['data']
type Modal =
  | { type: 'bind' | 'settings' | 'templateBackup' | 'conflict' }
  | { type: 'unbind'; repository: GithubRepository }
  | {
      type: 'rebind'
      current: GithubRepository
      target: GithubRepository
      accountId: string | null
    }
  | { type: 'push'; plan: GithubPushPlan }
  | {
      type: 'templatePush'
      plan: GithubTemplateBackupPlan
      accountId: string | null
    }
  | { type: 'update'; target: UpdateTarget }
  | { type: 'initialUpload'; review: InitialReview }
  | { type: 'discardInitialUpload'; pending: InitialPending }
type Operation =
  | 'bind'
  | 'unbind'
  | 'auto'
  | 'prepare'
  | 'push'
  | 'update'
  | 'templatePrepare'
  | 'templatePush'
  | 'initialPrepare'
  | 'initialConfirm'
  | 'initialDiscard'
const requiresAuthorization = (error: unknown) =>
  [
    'creation.github.error.authentication',
    'creation.github.error.disconnected',
    'creation.github.error.accessDenied',
  ].includes(githubErrorKey(error))
const targetChanged = (error: unknown) =>
  [
    'creation.github.error.conflict',
    'creation.github.error.workspaceChanged',
    'creation.github.error.confirmationExpired',
  ].includes(githubErrorKey(error))

export function CreationGitHubSync({
  identity,
  active,
  head,
  branch,
  localBusy,
  updateBlock,
  beginUpdate,
  endUpdate,
  onUpdated,
  onTemplateBackupFinished,
}: {
  identity: string
  active: boolean
  head: string | null
  branch: string | null
  localBusy: boolean
  updateBlock: 'drafts' | 'task' | 'runtime' | null
  beginUpdate: () => boolean
  endUpdate: () => void
  onUpdated: (commit: string | null) => Promise<boolean>
  onTemplateBackupFinished: () => void
}) {
  const { t } = useTranslation()
  const { status: auth } = useGithubAuth(active)
  const accountId = auth?.account?.id ?? null
  const [status, setStatus] = useState<GithubSyncStatus | null>(null)
  const [modal, setModal] = useState<Modal | null>(null)
  const [busy, setBusy] = useState<Operation | null>(null)
  const [checking, setChecking] = useState(false)
  const [readError, setReadError] = useState<unknown>(null)
  const [error, setError] = useState<unknown>(null)
  const [modalError, setModalError] = useState<unknown>(null)
  const live = useRef(true)
  const inFlight = useRef(false)
  const pendingToast = useRef(false)
  const readSequence = useRef(0)
  const remoteChecking = useRef(false)
  const visited = useRef(false)
  const observedAccount = useRef<string | null>(null)
  const observedBranch = useRef<string | null>(null)
  const trigger = useRef<HTMLElement | null>(null)
  const row = useRef<HTMLElement | null>(null)
  const templateConfirmCancel = useRef<HTMLButtonElement | null>(null)
  const statusId = useId()
  const toastId = `creation-github-sync:${identity}`
  const owns = () =>
    live.current &&
    useCreationStore.getState().workspace?.project.identity === identity

  useEffect(() => {
    live.current = true
    return () => {
      live.current = false
      if (pendingToast.current) notifications.flow.dismiss(toastId)
    }
  }, [toastId])

  const read = async (refresh: boolean) => {
    if (!owns() || inFlight.current || (!refresh && remoteChecking.current))
      return
    const sequence = ++readSequence.current
    if (refresh) {
      remoteChecking.current = true
      setChecking(true)
    }
    try {
      const result = unwrapGithub(
        await commands.githubSyncStatus(identity, refresh)
      )
      if (owns() && sequence === readSequence.current) {
        setStatus(result)
        setReadError(null)
        if (result.templateBackupRecovered) {
          setError(null)
          onTemplateBackupFinished()
        }
      }
    } catch (cause) {
      if (owns() && sequence === readSequence.current) setReadError(cause)
    } finally {
      if (owns() && sequence === readSequence.current) {
        remoteChecking.current = false
        setChecking(false)
      }
    }
  }
  const readFromEffect = useEffectEvent(read)
  useEffect(() => {
    if (!active) {
      visited.current = false
      return
    }
    const entering = !visited.current
    const accountChanged = observedAccount.current !== accountId
    const branchChanged = observedBranch.current !== branch
    visited.current = true
    observedAccount.current = accountId
    observedBranch.current = branch
    void readFromEffect(entering || accountChanged || branchChanged)
  }, [active, identity, head, branch, accountId])
  useEffect(() => {
    if (!active || !status?.pending) return
    const timer = setInterval(() => void readFromEffect(false), 3000)
    return () => clearInterval(timer)
  }, [active, status?.pending])

  const repo = status?.repository
  const templatePending = status?.templateBackupPending
  const initialPending = status?.initialUploadPending
  const initialAccountMatches = accountId === initialPending?.target.accountId
  const templateAccountMatches =
    !status?.accountId || accountId === status.accountId
  const initialUnavailable =
    initialPending?.requestStarted &&
    ['repositoryUnavailable', 'accessDenied'].some(
      type => githubErrorKey(error) === `creation.github.error.${type}`
    )
  const templateBackupEligible = Boolean(
    !repo &&
    !templatePending &&
    status?.templateBackupEligible &&
    auth?.configured
  )
  const showDialog =
    active &&
    modal &&
    status &&
    (modal.type !== 'templateBackup' || templateBackupEligible)
  const issue = readError ?? status?.issue ?? null
  const reconnect =
    requiresAuthorization(issue ?? error) ||
    (Boolean(repo) &&
      githubErrorKey(issue ?? error) ===
        'creation.github.error.repositoryUnavailable')
  const unavailable = [
    issue,
    templatePending || initialPending ? null : error,
  ].some(cause =>
    ['network', 'timeout', 'serviceUnavailable', 'rateLimited'].some(
      type => githubErrorKey(cause) === `creation.github.error.${type}`
    )
  )
  const visibleIssue =
    templatePending &&
    githubErrorKey(issue) === 'creation.github.error.accessDenied'
      ? { type: 'templatePushDenied' }
      : issue
  const sameBranch = status?.branch === branch && status?.head === head
  const canPush = Boolean(
    repo?.canPush && accountId && status?.accountId === accountId && !reconnect
  )
  const autoPaused =
    sameBranch &&
    Boolean(status?.autoBackupPaused || (status?.autoBackup && !canPush))
  const autoEnabled = sameBranch && !autoPaused && Boolean(status?.autoBackup)
  const needsFirstBackup = sameBranch && !status?.firstBackupConfirmed
  const canFetch = Boolean(
    repo &&
    (!repo.private ||
      (accountId && accountId === status?.accountId && !reconnect))
  )
  const disabled = busy !== null || checking || localBusy
  const templateConfirmToken =
    modal?.type === 'templatePush' ? modal.plan.token : null
  useEffect(() => {
    if (templateConfirmToken) templateConfirmCancel.current?.focus()
  }, [templateConfirmToken])
  const canConfirmTemplateBackup =
    modal?.type === 'templatePush' &&
    modal.accountId === accountId &&
    (modal.plan.resuming ||
      (modal.plan.branch === branch && modal.plan.head === head))
  const canUpdate = Boolean(
    canFetch &&
    !unavailable &&
    sameBranch &&
    status?.relation === 'behind' &&
    status?.remoteHead &&
    !updateBlock
  )
  const canApply = (target: UpdateTarget) =>
    canUpdate &&
    repo?.id === target.repositoryId &&
    status?.head === target.head &&
    status?.branch === target.branch &&
    status?.remoteHead === target.remoteHead
  const canPrepare = Boolean(
    canPush &&
    !unavailable &&
    sameBranch &&
    status?.branch &&
    status.head &&
    ['unchecked', 'ahead', 'newBranch', 'deletedBranch'].includes(
      status.relation
    )
  )
  const relation = t(
    `creation.github.relation.${sameBranch ? status.relation : 'unchecked'}`
  )
  const attention = Boolean(
    issue ||
    status?.pending ||
    templatePending ||
    initialPending ||
    status?.relation === 'diverged' ||
    status?.relation === 'deletedBranch'
  )
  const showModal = (value: Modal) => {
    if (!modal)
      trigger.current =
        document.activeElement instanceof HTMLElement
          ? document.activeElement
          : null
    setModalError(null)
    setError(null)
    setModal(value)
  }
  const closeModal = () => {
    setModalError(null)
    setModal(null)
  }
  const translatedError = (cause: unknown) =>
    t(githubErrorKey(cause), {
      defaultValue: t('creation.github.error.unknown'),
    })
  const run = async (kind: Operation, work: () => Promise<void>) => {
    if (inFlight.current || !owns() || localBusy) return
    inFlight.current = true
    readSequence.current++
    remoteChecking.current = false
    setChecking(false)
    setBusy(kind)
    setError(null)
    setModalError(null)
    if (
      kind === 'prepare' ||
      kind === 'push' ||
      kind === 'update' ||
      kind === 'templatePrepare' ||
      kind === 'templatePush' ||
      kind === 'initialPrepare' ||
      kind === 'initialConfirm'
    ) {
      pendingToast.current = true
      notifications.flow.step(toastId, t(`creation.github.operation.${kind}`))
    }
    let refreshCache = false
    try {
      await work()
    } catch (cause) {
      if (owns()) {
        refreshCache =
          kind === 'templatePush' ||
          kind === 'templatePrepare' ||
          kind === 'initialConfirm' ||
          targetChanged(cause)
        if (requiresAuthorization(cause)) setReadError(cause)
        const feedback =
          kind === 'templatePush' &&
          githubErrorKey(cause) === 'creation.github.error.accessDenied'
            ? { type: 'templatePushDenied' }
            : cause
        if (
          kind === 'push' ||
          kind === 'templatePush' ||
          kind === 'initialConfirm'
        ) {
          // Native confirmation tickets are consumed by the first attempt.
          closeModal()
          setError(feedback)
        } else if (modal) setModalError(feedback)
        else setError(feedback)
        if (pendingToast.current) {
          pendingToast.current = false
          notifications.flow.fail(
            toastId,
            t('creation.github.operationFailed'),
            translatedError(feedback)
          )
        }
      }
    } finally {
      if (pendingToast.current) {
        pendingToast.current = false
        notifications.flow.dismiss(toastId)
      }
      inFlight.current = false
      if (owns()) setBusy(null)
      if (refreshCache) void read(false)
    }
  }
  const accept = (snapshot: GithubSyncStatus) => {
    if (owns()) {
      setStatus(snapshot)
      setReadError(null)
    }
  }
  const push = async (plan: GithubPushPlan) => {
    if (!owns()) return
    notifications.flow.step(toastId, t('creation.github.operation.push'))
    const snapshot = unwrapGithub(
      await commands.githubPush(identity, plan.token)
    )
    if (!owns()) return
    accept(snapshot)
    closeModal()
    pendingToast.current = false
    notifications.flow.succeed(
      toastId,
      t('creation.github.pushed', {
        branch: plan.branch,
        repository: plan.repository.fullName,
      })
    )
  }
  const preparePush = (confirmExistingOnly = false) =>
    void run('prepare', async () => {
      const result = unwrapGithub(
        await commands.githubPreparePush(identity, confirmExistingOnly)
      )
      if (!owns()) return
      if (result.type === 'alreadySynced') {
        accept(result.status)
        return
      }
      const { plan } = result
      if (
        plan.branch !== branch ||
        plan.head !== head ||
        plan.repository.id !== repo?.id
      ) {
        throw { type: 'confirmationExpired' }
      }
      if (plan.confirmPublic || plan.confirmRecreate)
        showModal({ type: 'push', plan })
      else await push(plan)
    })
  const finishTemplateBackup = (
    snapshot: GithubSyncStatus,
    target: Pick<GithubTemplateBackupPlan, 'branch' | 'repository'>
  ) => {
    accept(snapshot)
    closeModal()
    onTemplateBackupFinished()
    pendingToast.current = false
    notifications.flow.succeed(
      toastId,
      t('creation.github.pushed', {
        branch: target.branch,
        repository: target.repository.fullName,
      })
    )
  }
  const prepareTemplateBackup = (target: GithubTemplateBackupTarget | null) =>
    void run('templatePrepare', async () => {
      const result = unwrapGithub(
        await commands.githubPrepareTemplateBackup(identity, target)
      )
      if (!owns()) return
      if (result.type === 'completed') {
        accept(result.status)
        closeModal()
        onTemplateBackupFinished()
      } else {
        showModal({ type: 'templatePush', plan: result.plan, accountId })
      }
    })
  const pushTemplateBackup = (plan: GithubTemplateBackupPlan) =>
    void run('templatePush', async () => {
      if (!canConfirmTemplateBackup) return
      const snapshot = unwrapGithub(
        await commands.githubPushTemplateBackup(identity, plan.token)
      )
      if (owns()) finishTemplateBackup(snapshot, plan)
    })
  const prepareInitialUpload = () =>
    void run('initialPrepare', async () => {
      const review = unwrapGithub(
        await commands.githubPrepareInitialUpload(identity)
      )
      if (owns()) showModal({ type: 'initialUpload', review })
    })
  const confirmInitialUpload = (review: InitialReview) =>
    void run('initialConfirm', async () => {
      if (accountId !== review.target.accountId) return
      const snapshot = unwrapGithub(
        await commands.githubConfirmInitialUpload(identity, review.token)
      )
      if (owns() && snapshot.repository)
        finishTemplateBackup(snapshot, {
          branch: review.branch,
          repository: snapshot.repository,
        })
    })
  const discardInitialUpload = (pending: InitialPending) =>
    void run('initialDiscard', async () => {
      const snapshot = unwrapGithub(
        await commands.githubDiscardInitialUpload(identity, {
          target: pending.target,
          branch: pending.branch,
          head: pending.head,
          requestStarted: pending.requestStarted,
          repositoryId: pending.repository?.id ?? null,
        })
      )
      if (!owns()) return
      accept(snapshot)
      closeModal()
    })
  const prepareUpdate = () => {
    if (
      !canUpdate ||
      !repo ||
      !status?.branch ||
      !status.head ||
      !status.remoteHead
    )
      return
    showModal({
      type: 'update',
      target: {
        repositoryId: repo.id,
        branch: status.branch,
        head: status.head,
        remoteHead: status.remoteHead,
      },
    })
  }
  const update = (target: UpdateTarget) => {
    if (inFlight.current || !canApply(target) || !beginUpdate()) return
    void run('update', async () => {
      const snapshot = unwrapGithub(
        await commands.githubUpdate(identity, target)
      )
      if (!owns()) return
      accept(snapshot)
      closeModal()
      notifications.flow.step(
        toastId,
        t('creation.versions.progress.synchronizing')
      )
      const synchronized = await onUpdated(snapshot.head).catch(() => false)
      if (!owns()) return
      pendingToast.current = false
      if (synchronized)
        notifications.flow.succeed(toastId, t('creation.github.updated'))
      else
        notifications.flow.warn(
          toastId,
          t('creation.github.updateRefreshFailed')
        )
    }).finally(endUpdate)
  }

  const bindRepository = (target: GithubRepository, expected: string | null) =>
    void run('bind', async () => {
      const snapshot = unwrapGithub(
        await commands.githubBindRepository(
          identity,
          target.fullName,
          expected,
          target.id
        )
      )
      if (!owns()) return
      accept(snapshot)
      closeModal()
    })

  const refresh = () => {
    setError(null)
    setModalError(null)
    void read(true)
  }
  const openRepository = (fullName: string) => {
    const [owner, name] = fullName.split('/')
    if (!owner || !name) return
    void openUrl(
      `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`
    ).catch(setModalError)
  }
  const route = branch
  const displayedRelation = sameBranch ? status?.relation : 'unchecked'
  const openAccountSettings = () =>
    useSettingsStore.getState().openSettings('github')
  const action = (() => {
    if (unavailable) return { label: 'creation.github.refresh', run: refresh }
    if (initialPending && initialAccountMatches)
      return {
        label: 'creation.github.initialUpload.resume',
        run: prepareInitialUpload,
      }
    if (templatePending && accountId && templateAccountMatches && !reconnect)
      return {
        label: 'creation.github.templateBackup.resume',
        run: () => prepareTemplateBackup(null),
      }
    if (
      (initialPending && !initialAccountMatches) ||
      (templatePending &&
        (!accountId || !templateAccountMatches || reconnect)) ||
      auth?.configured === false
    )
      return { label: 'settings.github', run: openAccountSettings }
    if (repo && displayedRelation === 'diverged')
      return {
        label: 'creation.github.conflictHelp',
        run: () => showModal({ type: 'conflict' }),
      }
    if (repo && canPush && needsFirstBackup && displayedRelation === 'equal')
      return {
        label: 'creation.github.confirmExistingBackup',
        run: () => preparePush(true),
      }
    if (repo && displayedRelation === 'behind' && canFetch)
      return {
        label: 'creation.github.update',
        run: prepareUpdate,
        blocked: !canUpdate,
      }
    if (repo && !canPush)
      return { label: 'settings.github', run: openAccountSettings }
    if (repo && displayedRelation === 'deletedBranch')
      return {
        label: 'creation.github.recreate',
        run: () => preparePush(),
        blocked: !canPrepare,
      }
    if (canPrepare)
      return { label: 'creation.github.backup', run: () => preparePush() }
    if (templateBackupEligible)
      return {
        label: 'creation.github.templateBackup.open',
        run: () => showModal({ type: 'templateBackup' }),
      }
    return null
  })()

  return (
    <section
      ref={row}
      className="creation-github-strip pnds-focus-ring"
      aria-label="GitHub"
      tabIndex={-1}
    >
      <div className="creation-github-strip-row">
        <div
          id={statusId}
          role="status"
          className="creation-github-status"
          data-attention={attention || unavailable}
        >
          <Cloud aria-hidden="true" className="size-4 shrink-0" />
          <strong>GitHub</strong>
          {route && (
            <code className="creation-github-branch" dir="ltr">
              {route}
            </code>
          )}
          <span>
            {checking ? (
              t('creation.github.checking')
            ) : repo ? (
              <>
                {status?.stale || unavailable
                  ? t('creation.github.cached', { status: relation })
                  : relation}
                {status?.pending && <> {t('creation.github.pending')}</>}
                {autoPaused && <> {t('creation.github.autoBackupPaused')}</>}
                {!canPush && <> {t('creation.github.authorizeBackup')}</>}
                {displayedRelation === 'behind' && updateBlock && (
                  <> {t(`creation.github.updateBlock.${updateBlock}`)}</>
                )}
              </>
            ) : templatePending ? (
              <>
                {t('creation.github.templateBackup.pending', {
                  repository: templatePending.repository.fullName,
                  branch: templatePending.branch,
                })}
                {!templateAccountMatches && (
                  <> {t('creation.github.initialUpload.originalAccount')}</>
                )}
              </>
            ) : initialPending ? (
              <>
                {t('creation.github.templateBackup.pending', {
                  repository: `${initialPending.target.owner}/${initialPending.target.name}`,
                  branch: initialPending.branch,
                })}
                {!initialAccountMatches && (
                  <> {t('creation.github.initialUpload.originalAccount')}</>
                )}
              </>
            ) : status?.supported === false ? (
              t('creation.github.error.unsupported')
            ) : auth?.configured === false ? (
              t('creation.github.error.notConfigured')
            ) : status ? (
              t('creation.github.localOnly')
            ) : (
              t('creation.loading')
            )}
          </span>
          {repo && (
            <span className="creation-github-repository" dir="ltr">
              {repo.fullName}
            </span>
          )}
        </div>

        <div className="creation-github-actions">
          {action && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled || action.blocked}
              aria-describedby={statusId}
              onClick={action.run}
            >
              {t(action.label)}
            </Button>
          )}
          <Button
            size="sm"
            variant="ghost"
            disabled={disabled || !status?.supported}
            onClick={() => showModal({ type: 'settings' })}
          >
            {t('creation.github.settings')}
          </Button>
        </div>
      </div>
      {initialUnavailable && (
        <div className="grid gap-2 text-sm">
          <p>{t('creation.github.initialUpload.unavailable')}</p>
          {auth?.installationUrl && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => {
                if (auth.installationUrl)
                  void openUrl(auth.installationUrl).catch(setError)
              }}
            >
              {t('creation.github.manageRepositories')}
            </Button>
          )}
        </div>
      )}
      {visibleIssue !== null && <GithubErrorNotice error={visibleIssue} />}
      {error !== null &&
        (visibleIssue === null ||
          githubErrorKey(error) !== githubErrorKey(visibleIssue)) && (
          <GithubErrorNotice error={error} />
        )}
      {status?.templateBackupPublished &&
        !status.stale &&
        !checking &&
        issue === null &&
        repo &&
        !repo.private &&
        !templatePending && (
          <CreationGitHubPublicDirectory
            key={repo.id}
            repository={repo.fullName}
          />
        )}
      {showDialog && (
        <Dialog
          open
          onOpenChange={value => {
            if (!value && busy === null) closeModal()
          }}
        >
          <DialogContent
            showCloseButton={false}
            className="max-h-[85vh] overflow-auto"
            onCloseAutoFocus={event => {
              event.preventDefault()
              const source = trigger.current
              trigger.current = null
              if (source?.isConnected && !source.matches(':disabled'))
                source.focus()
              else row.current?.focus()
            }}
          >
            <DialogHeader>
              <DialogTitle>
                {t(`creation.github.dialog.${modal.type}.title`)}
              </DialogTitle>
              <DialogDescription>
                {t(`creation.github.dialog.${modal.type}.hint`)}
              </DialogDescription>
            </DialogHeader>
            {modal.type === 'templateBackup' ? (
              <>
                {modalError !== null && (
                  <GithubErrorNotice error={modalError} />
                )}
                <CreationGitHubTemplateBackup
                  identity={identity}
                  branch={branch}
                  head={head}
                  disabled={localBusy || busy !== null}
                  onClose={closeModal}
                  onReview={prepareTemplateBackup}
                />
              </>
            ) : modal.type === 'bind' ? (
              <CreationGitHubBind
                status={status}
                busy={busy !== null}
                error={modalError}
                reconnect={reconnect}
                onCancel={closeModal}
                onBind={target => {
                  if (repo)
                    showModal({
                      type: 'rebind',
                      current: repo,
                      target,
                      accountId,
                    })
                  else bindRepository(target, null)
                }}
              />
            ) : (
              <>
                {modalError !== null && (
                  <GithubErrorNotice error={modalError} />
                )}
                {modal.type === 'settings' && (
                  <>
                    <div className="grid gap-2 text-sm">
                      <div className="flex flex-wrap items-center gap-2">
                        <span>{t('creation.github.repository')}</span>
                        {repo ? (
                          <>
                            <strong className="break-all" dir="ltr">
                              {repo.fullName}
                            </strong>
                            <span className="creation-github-visibility">
                              {t(
                                repo.private
                                  ? 'creation.github.private'
                                  : 'creation.github.public'
                              )}
                            </span>
                          </>
                        ) : (
                          <span>{t('creation.github.unbound')}</span>
                        )}
                      </div>
                      {route && (
                        <p className="text-muted-foreground">
                          {t('creation.github.currentRoute', { route })}
                        </p>
                      )}
                    </div>
                    {repo && branch && (
                      <div className="grid gap-1 text-sm">
                        <div className="flex items-center justify-between gap-2">
                          <label htmlFor={`${statusId}-auto`}>
                            {t('creation.github.autoBackup')}
                          </label>
                          <Switch
                            id={`${statusId}-auto`}
                            checked={autoEnabled}
                            disabled={
                              disabled ||
                              !sameBranch ||
                              (!autoEnabled &&
                                (!canPush || unavailable || needsFirstBackup))
                            }
                            onCheckedChange={enabled =>
                              void run('auto', async () => {
                                accept(
                                  unwrapGithub(
                                    await commands.githubSetAutoBackup(
                                      identity,
                                      repo.id,
                                      branch,
                                      repo.private,
                                      enabled
                                    )
                                  )
                                )
                              })
                            }
                          />
                        </div>
                        {needsFirstBackup && (
                          <p className="text-muted-foreground">
                            {t('creation.github.autoBackupFirstRequired')}
                          </p>
                        )}
                        {needsFirstBackup &&
                          canPush &&
                          !unavailable &&
                          displayedRelation === 'behind' && (
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              disabled={disabled}
                              onClick={() => preparePush(true)}
                            >
                              {t('creation.github.confirmExistingBackup')}
                            </Button>
                          )}
                        {autoPaused && !needsFirstBackup && (
                          <p className="text-muted-foreground">
                            {t('creation.github.autoBackupResumeHint')}
                          </p>
                        )}
                      </div>
                    )}
                    <div className="flex flex-wrap gap-2">
                      {repo && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => openRepository(repo.fullName)}
                        >
                          <ExternalLink aria-hidden="true" />
                          {t('creation.github.openRepository')}
                        </Button>
                      )}
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={disabled}
                        onClick={refresh}
                      >
                        <RefreshCw aria-hidden="true" />
                        {t('creation.github.refresh')}
                      </Button>
                      {repo && !canPush && auth?.installationUrl && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() => {
                            if (auth.installationUrl)
                              void openUrl(auth.installationUrl).catch(
                                setModalError
                              )
                          }}
                        >
                          {t('creation.github.manageRepositories')}
                        </Button>
                      )}
                      {!initialPending &&
                        !templatePending &&
                        auth?.configured && (
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            disabled={disabled}
                            onClick={() => showModal({ type: 'bind' })}
                          >
                            {t(
                              repo
                                ? 'creation.github.changeRepository'
                                : 'creation.github.bindRepository'
                            )}
                          </Button>
                        )}
                      {repo && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() =>
                            showModal({ type: 'unbind', repository: repo })
                          }
                        >
                          {t('creation.github.unbindRepository')}
                        </Button>
                      )}
                      {initialPending && (
                        <Button
                          type="button"
                          size="sm"
                          variant="outline"
                          disabled={disabled}
                          onClick={() =>
                            showModal({
                              type: 'discardInitialUpload',
                              pending: initialPending,
                            })
                          }
                        >
                          {t('creation.github.initialUpload.keepLocal')}
                        </Button>
                      )}
                    </div>
                  </>
                )}
                {modal.type === 'rebind' && (
                  <div className="grid gap-2 text-sm">
                    <p>
                      {t('creation.github.previousRepository', {
                        repository: modal.current.fullName,
                      })}
                    </p>
                    <p>
                      {t('creation.github.nextRepository', {
                        repository: modal.target.fullName,
                      })}
                    </p>
                    <p>
                      {t(
                        modal.target.private
                          ? 'creation.github.private'
                          : 'creation.github.public'
                      )}
                    </p>
                  </div>
                )}
                {modal.type === 'unbind' && (
                  <p dir="ltr" className="break-all text-sm">
                    {modal.repository.fullName}
                  </p>
                )}
                {modal.type === 'conflict' && (
                  <p className="text-sm">
                    {t('creation.github.relation.diverged')}
                  </p>
                )}
                {modal.type === 'push' && (
                  <div className="grid gap-2 text-sm">
                    <p dir="ltr" className="break-all">
                      {modal.plan.repository.fullName}{' '}
                      <code>
                        {modal.plan.branch} @ {modal.plan.head.slice(0, 12)}
                      </code>
                    </p>
                    {modal.plan.confirmPublic && (
                      <p>{t('creation.github.confirmPublic')}</p>
                    )}
                    {modal.plan.confirmRecreate && (
                      <p>{t('creation.github.confirmRecreate')}</p>
                    )}
                  </div>
                )}
                {modal.type === 'initialUpload' && (
                  <div className="grid gap-2 text-sm">
                    <p dir="ltr" className="break-all">
                      {modal.review.target.owner}/{modal.review.target.name}{' '}
                      <code>
                        {modal.review.branch} @ {modal.review.head.slice(0, 12)}
                      </code>
                    </p>
                    <p>
                      {t(
                        modal.review.target.private
                          ? 'creation.github.templateBackup.confirmPrivate'
                          : 'creation.github.templateBackup.confirmPublic'
                      )}
                    </p>
                    {modal.review.visibilityChanged && (
                      <p>
                        {t('creation.github.initialUpload.visibilityChanged')}
                      </p>
                    )}
                    {modal.review.needsRepositoryChoice && (
                      <p>
                        {t('creation.github.initialUpload.chooseRepository')}
                      </p>
                    )}
                  </div>
                )}
                {modal.type === 'templatePush' && (
                  <div className="grid gap-2 text-sm">
                    <p dir="ltr" className="break-all">
                      {modal.plan.repository.fullName}{' '}
                      <code>
                        {modal.plan.branch} @ {modal.plan.head.slice(0, 12)}
                      </code>
                    </p>
                    <p>
                      {modal.plan.confirmPublic
                        ? t('creation.github.templateBackup.confirmPublic')
                        : t('creation.github.templateBackup.confirmPrivate')}
                    </p>
                    {!canConfirmTemplateBackup && (
                      <GithubErrorNotice
                        error={{ type: 'confirmationExpired' }}
                      />
                    )}
                  </div>
                )}
                {modal.type === 'update' && (
                  <p dir="ltr" className="break-all text-sm">
                    {repo?.fullName}{' '}
                    <code>
                      {modal.target.branch} @{' '}
                      {modal.target.remoteHead.slice(0, 12)}
                    </code>
                  </p>
                )}
                <DialogFooter>
                  <Button
                    ref={
                      modal.type === 'templatePush'
                        ? templateConfirmCancel
                        : undefined
                    }
                    type="button"
                    variant="outline"
                    disabled={busy !== null}
                    onClick={closeModal}
                  >
                    {t(
                      modal.type === 'settings'
                        ? 'creation.github.done'
                        : 'creation.cancel'
                    )}
                  </Button>
                  {modal.type === 'push' && (
                    <Button
                      type="button"
                      disabled={
                        disabled ||
                        !canPush ||
                        unavailable ||
                        modal.plan.branch !== branch ||
                        modal.plan.head !== head ||
                        modal.plan.repository.id !== repo?.id
                      }
                      onClick={() => void run('push', () => push(modal.plan))}
                    >
                      {t('creation.github.backup')}
                    </Button>
                  )}
                  {modal.type === 'templatePush' && (
                    <Button
                      type="button"
                      disabled={disabled || !canConfirmTemplateBackup}
                      onClick={() => pushTemplateBackup(modal.plan)}
                    >
                      {t('creation.github.backup')}
                    </Button>
                  )}
                  {modal.type === 'initialUpload' && (
                    <Button
                      type="button"
                      disabled={
                        disabled || accountId !== modal.review.target.accountId
                      }
                      onClick={() => confirmInitialUpload(modal.review)}
                    >
                      {t(
                        modal.review.needsRepositoryChoice
                          ? 'creation.github.initialUpload.useRepository'
                          : modal.review.repository
                            ? 'creation.github.initialUpload.upload'
                            : 'creation.github.initialUpload.create'
                      )}
                    </Button>
                  )}
                  {modal.type === 'discardInitialUpload' && (
                    <Button
                      type="button"
                      disabled={disabled}
                      onClick={() => discardInitialUpload(modal.pending)}
                    >
                      {t('creation.github.initialUpload.keepLocal')}
                    </Button>
                  )}
                  {modal.type === 'update' && (
                    <Button
                      type="button"
                      disabled={disabled || !canApply(modal.target)}
                      onClick={() => update(modal.target)}
                    >
                      {t('creation.github.update')}
                    </Button>
                  )}
                  {modal.type === 'rebind' && (
                    <Button
                      type="button"
                      disabled={
                        disabled ||
                        modal.accountId !== accountId ||
                        modal.current.id !== repo?.id
                      }
                      onClick={() =>
                        bindRepository(modal.target, modal.current.id)
                      }
                    >
                      {t('creation.github.confirmChangeRepository')}
                    </Button>
                  )}
                  {modal.type === 'unbind' && (
                    <Button
                      type="button"
                      disabled={disabled || modal.repository.id !== repo?.id}
                      onClick={() =>
                        void run('unbind', async () => {
                          const snapshot = unwrapGithub(
                            await commands.githubUnbindRepository(
                              identity,
                              modal.repository.id
                            )
                          )
                          if (!owns()) return
                          accept(snapshot)
                          closeModal()
                        })
                      }
                    >
                      {t('creation.github.unbindRepository')}
                    </Button>
                  )}
                </DialogFooter>
              </>
            )}
          </DialogContent>
        </Dialog>
      )}
    </section>
  )
}
