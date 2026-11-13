import { useEffect, useEffectEvent, useId, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { RefreshCw } from 'lucide-react'
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
import { commands, type GithubPushPlan } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useSettingsStore } from '@/store/settings-store'
import { GithubErrorNotice } from './CreationGitHubAccount'
import { CreationGitHubBind } from './CreationGitHubBind'
import { CreationGitHubTemplateBackup } from './CreationGitHubTemplateBackup'
import {
  githubErrorKey,
  unwrapGithub,
  useGithubAuth,
  type GithubSyncStatus,
} from './creation-github-data'
import './creation-github.css'

type UpdateTarget = Parameters<typeof commands.githubUpdate>[1]
type Modal =
  | { type: 'bind' | 'settings' | 'unbind' | 'templateBackup' }
  | { type: 'push'; plan: GithubPushPlan }
  | { type: 'update'; target: UpdateTarget }
type Operation = 'bind' | 'unbind' | 'auto' | 'prepare' | 'push' | 'update'
const requiresAuthorization = (error: unknown) =>
  [
    'creation.github.error.authentication',
    'creation.github.error.disconnected',
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
  const trigger = useRef<HTMLElement | null>(null)
  const row = useRef<HTMLElement | null>(null)
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
    visited.current = true
    observedAccount.current = accountId
    void readFromEffect(entering || accountChanged)
  }, [active, identity, head, branch, accountId])
  useEffect(() => {
    if (!active || !status?.pending) return
    const timer = setInterval(() => void readFromEffect(false), 3000)
    return () => clearInterval(timer)
  }, [active, status?.pending])

  const repo = status?.repository
  const templateBackupEligible = Boolean(
    !repo && status?.templateBackupEligible && auth?.configured
  )
  const showDialog =
    active &&
    modal &&
    status &&
    (modal.type !== 'templateBackup' || templateBackupEligible)
  const issue = readError ?? status?.issue ?? null
  const reconnect = requiresAuthorization(issue)
  const sameBranch = status?.branch === branch && status?.head === head
  const canPush = Boolean(
    repo?.canPush && accountId && status?.accountId === accountId && !reconnect
  )
  const canFetch = Boolean(
    repo &&
    (!repo.private ||
      (accountId && accountId === status?.accountId && !reconnect))
  )
  const disabled = busy !== null || checking || localBusy
  const canUpdate = Boolean(
    canFetch &&
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
    sameBranch &&
    status?.branch &&
    status.head &&
    ['unchecked', 'ahead', 'newBranch', 'deletedBranch'].includes(
      status.relation
    )
  )
  const relation = status
    ? t(`creation.github.relation.${status.relation}`)
    : ''
  const attention = Boolean(
    issue ||
    status?.pending ||
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
    if (kind === 'prepare' || kind === 'push' || kind === 'update') {
      pendingToast.current = true
      notifications.flow.step(toastId, t(`creation.github.operation.${kind}`))
    }
    let refreshCache = false
    try {
      await work()
    } catch (cause) {
      if (owns()) {
        refreshCache = targetChanged(cause)
        if (requiresAuthorization(cause)) setReadError(cause)
        if (kind === 'push') {
          // Native confirmation tickets are consumed by the first attempt.
          closeModal()
          setError(cause)
        } else if (modal) setModalError(cause)
        else setError(cause)
        if (pendingToast.current) {
          pendingToast.current = false
          notifications.flow.fail(
            toastId,
            t('creation.github.operationFailed'),
            translatedError(cause)
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
  const preparePush = () =>
    void run('prepare', async () => {
      const result = unwrapGithub(await commands.githubPreparePush(identity))
      if (!owns()) return
      if (result.type === 'alreadySynced') {
        accept(result.status)
        return
      }
      const { plan } = result
      if (plan.confirmPublic || plan.confirmRecreate)
        showModal({ type: 'push', plan })
      else await push(plan)
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

  return (
    <section
      ref={row}
      className="creation-github-strip pnds-focus-ring"
      aria-label="GitHub"
      tabIndex={-1}
    >
      <div className="creation-github-strip-row">
        <div className="creation-github-identity">
          <strong>GitHub</strong>
          {repo && (
            <>
              <span className="creation-github-repository" dir="ltr">
                {repo.fullName}
              </span>
              <span className="creation-github-visibility">
                {t(
                  repo.private
                    ? 'creation.github.private'
                    : 'creation.github.public'
                )}
              </span>
            </>
          )}
          {(branch || status?.branch) && (
            <code className="creation-github-branch" dir="ltr">
              {branch ?? status?.branch}
            </code>
          )}
        </div>
        <div className="creation-github-actions">
          {templateBackupEligible && (
            <Button
              size="sm"
              variant="outline"
              disabled={disabled}
              onClick={() => showModal({ type: 'templateBackup' })}
            >
              {t('creation.github.templateBackup.open')}
            </Button>
          )}
          {repo ? (
            <>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || !canUpdate}
                aria-describedby={statusId}
                onClick={prepareUpdate}
              >
                {t('creation.github.update')}
              </Button>
              <Button
                size="sm"
                variant="outline"
                disabled={disabled || !canPrepare}
                aria-describedby={statusId}
                onClick={preparePush}
              >
                {t('creation.github.backup')}
              </Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={disabled}
                onClick={() => showModal({ type: 'settings' })}
              >
                {t('creation.github.settings')}
              </Button>
            </>
          ) : (
            status?.supported &&
            auth?.configured !== false && (
              <Button
                size="sm"
                variant="outline"
                disabled={disabled}
                onClick={() => showModal({ type: 'bind' })}
              >
                {t(
                  accountId
                    ? 'creation.github.bindRepository'
                    : 'creation.github.connect'
                )}
              </Button>
            )
          )}
          {auth?.configured === false && (
            <Button
              size="sm"
              variant="outline"
              onClick={() => useSettingsStore.getState().openSettings('github')}
            >
              {t('settings.github')}
            </Button>
          )}
          <Button
            size="icon-sm"
            variant="ghost"
            disabled={disabled}
            aria-label={t('creation.github.refresh')}
            onClick={() => {
              setError(null)
              void read(true)
            }}
          >
            <RefreshCw aria-hidden="true" />
          </Button>
        </div>
      </div>
      <p
        id={statusId}
        role="status"
        className="creation-github-status"
        data-attention={attention}
      >
        {checking ? (
          t('creation.github.checking')
        ) : repo ? (
          <>
            {status?.stale
              ? t('creation.github.cached', { status: relation })
              : relation}
            {status?.pending && <> {t('creation.github.pending')}</>}
            {!canPush && <> {t('creation.github.authorizeBackup')}</>}
            {status?.relation === 'behind' && updateBlock && (
              <> {t(`creation.github.updateBlock.${updateBlock}`)}</>
            )}
          </>
        ) : status?.supported === false ? (
          t('creation.github.error.unsupported')
        ) : auth?.configured === false ? (
          t('creation.github.error.notConfigured')
        ) : status ? (
          t('creation.github.unbound')
        ) : (
          t('creation.loading')
        )}
      </p>
      {issue !== null && <GithubErrorNotice error={issue} />}
      {error !== null && error !== issue && <GithubErrorNotice error={error} />}
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
              <CreationGitHubTemplateBackup
                identity={identity}
                branch={branch}
                head={head}
                disabled={localBusy}
                onClose={closeModal}
              />
            ) : modal.type === 'bind' ? (
              <CreationGitHubBind
                status={status}
                busy={busy !== null}
                error={modalError}
                reconnect={reconnect}
                onCancel={closeModal}
                onBind={(name, expected) =>
                  void run('bind', async () => {
                    const snapshot = unwrapGithub(
                      await commands.githubBindRepository(
                        identity,
                        name,
                        expected
                      )
                    )
                    if (!owns()) return
                    accept(snapshot)
                    closeModal()
                  })
                }
              />
            ) : (
              <>
                {modalError !== null && (
                  <GithubErrorNotice error={modalError} />
                )}
                {modal.type === 'settings' && repo && (
                  <>
                    <div className="flex items-center justify-between gap-2 text-sm">
                      <label htmlFor={`${statusId}-auto`}>
                        {t('creation.github.autoBackup')}
                      </label>
                      <Switch
                        id={`${statusId}-auto`}
                        checked={status.autoBackup}
                        disabled={
                          busy !== null || (!status.autoBackup && !canPush)
                        }
                        onCheckedChange={enabled =>
                          void run('auto', async () => {
                            accept(
                              unwrapGithub(
                                await commands.githubSetAutoBackup(
                                  identity,
                                  repo.id,
                                  enabled
                                )
                              )
                            )
                          })
                        }
                      />
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => showModal({ type: 'bind' })}
                      >
                        {t(
                          canPush
                            ? 'creation.github.changeRepository'
                            : 'creation.github.authorizeAction'
                        )}
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={busy !== null}
                        onClick={() => showModal({ type: 'unbind' })}
                      >
                        {t('creation.github.unbindRepository')}
                      </Button>
                    </div>
                  </>
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
                      disabled={busy !== null}
                      onClick={() => void run('push', () => push(modal.plan))}
                    >
                      {t('creation.github.backup')}
                    </Button>
                  )}
                  {modal.type === 'update' && (
                    <Button
                      type="button"
                      disabled={busy !== null || !canApply(modal.target)}
                      onClick={() => update(modal.target)}
                    >
                      {t('creation.github.update')}
                    </Button>
                  )}
                  {modal.type === 'unbind' && repo && (
                    <Button
                      type="button"
                      disabled={busy !== null}
                      onClick={() =>
                        void run('unbind', async () => {
                          const snapshot = unwrapGithub(
                            await commands.githubUnbindRepository(
                              identity,
                              repo.id
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
