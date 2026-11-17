import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { commands } from '@/lib/tauri-bindings'
import {
  CreationGitHubAccount,
  GithubErrorNotice,
} from './CreationGitHubAccount'
import { CreationGitHubRepositoryField } from './CreationGitHubRepositoryField'
import {
  refreshGithubAuth,
  setGithubAccount,
  unwrapGithub,
  useGithubAuth,
  useGithubAuthStore,
  useGithubRepositories,
  type GithubTemplateBackupCheck,
  type GithubTemplateBackupTarget,
} from './creation-github-data'

const createFromTemplateUrl = 'https://github.com/xO-xN/PNDS-Template/generate'

type CheckResult = { target: string } & (
  | { status: 'checked'; result: GithubTemplateBackupCheck }
  | { status: 'error'; error: unknown }
)

export function CreationGitHubTemplateBackup({
  identity,
  branch,
  head,
  disabled,
  onClose,
  onReview,
}: {
  identity: string
  branch: string | null
  head: string | null
  disabled: boolean
  onClose: () => void
  onReview: (target: GithubTemplateBackupTarget) => void
}) {
  const { t } = useTranslation()
  const { status: auth, error: authError } = useGithubAuth(true)
  const accountId = auth?.account?.id ?? null
  const accountGeneration = useGithubAuthStore(state => state.generation)
  const catalog = useGithubRepositories(accountId)
  const repositories = (catalog.repositories ?? []).filter(repo => repo.canPush)
  const [selectedId, setSelectedId] = useState('')
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<CheckResult | null>(null)
  const [browserError, setBrowserError] = useState<unknown>(null)
  const selected = repositories.find(repo => repo.id === selectedId)
  const target = selected
    ? JSON.stringify([
        identity,
        branch,
        head,
        accountId,
        accountGeneration,
        catalog.revision,
        selected.id,
        selected.fullName,
        selected.defaultBranch,
        selected.private,
      ])
    : null
  const current = result?.target === target ? result : null
  const checked = current?.status === 'checked' ? current.result : null
  const verifiedTarget =
    checked?.verification.status === 'ready' &&
    branch === checked.repository.defaultBranch &&
    head
      ? {
          repositoryId: checked.repository.id,
          fullName: checked.repository.fullName,
          branch,
          head,
          remoteHead: checked.verification.remoteHead,
          private: checked.repository.private,
        }
      : null

  const createRepository = async () => {
    setBrowserError(null)
    try {
      await openUrl(createFromTemplateUrl)
    } catch (cause) {
      setBrowserError(cause)
    }
  }
  const verifyRepository = async () => {
    if (!selected || !target || checking || disabled) return
    setChecking(true)
    setResult(null)
    try {
      const result = unwrapGithub(
        await commands.githubVerifyTemplateBackup(
          identity,
          selected.fullName,
          selected.id
        )
      )
      const repository = result.repository
      const sameSelection =
        repository.fullName === selected.fullName &&
        repository.defaultBranch === selected.defaultBranch &&
        repository.private === selected.private
      if (
        repository.id !== selected.id ||
        (result.verification.status === 'ready' && !sameSelection)
      ) {
        setResult({
          status: 'error',
          target,
          error: { type: 'templateTargetChanged' },
        })
      } else {
        setResult({ status: 'checked', target, result })
      }
    } catch (error) {
      setResult({ status: 'error', target, error })
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <div>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={createRepository}
        >
          {t('creation.github.templateBackup.create')}
        </Button>
      </div>
      {browserError !== null && <GithubErrorNotice error={browserError} />}
      {auth?.account ? (
        <fieldset disabled={disabled || checking}>
          <CreationGitHubRepositoryField
            auth={auth}
            catalog={catalog}
            repositories={repositories}
            selected={selected?.id ?? ''}
            onSelect={id => {
              setSelectedId(id)
              setResult(null)
            }}
          />
        </fieldset>
      ) : (
        <CreationGitHubAccount
          status={auth}
          error={authError}
          onRefresh={() => void refreshGithubAuth()}
          onConnected={setGithubAccount}
        />
      )}
      {current?.status === 'error' && (
        <GithubErrorNotice error={current.error} />
      )}
      {checked && (
        <p
          role={checked.verification.status === 'ready' ? 'status' : 'alert'}
          className={
            checked.verification.status === 'ready'
              ? 'break-words text-sm'
              : 'break-words text-sm text-(--pnds-danger)'
          }
        >
          {t(
            `creation.github.templateBackup.verification.${checked.verification.status}`,
            {
              repository: checked.repository.fullName,
              branch: checked.repository.defaultBranch,
              version:
                checked.verification.status === 'ready'
                  ? checked.verification.templateVersion
                  : undefined,
            }
          )}
        </p>
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={onClose}
        >
          {t('creation.git.close')}
        </Button>
        <Button
          type="button"
          variant={verifiedTarget ? 'outline' : 'default'}
          disabled={disabled || checking || !selected}
          onClick={verifyRepository}
        >
          {t(
            checking
              ? 'creation.github.templateBackup.checking'
              : 'creation.github.templateBackup.verify'
          )}
        </Button>
        {verifiedTarget && (
          <Button
            type="button"
            disabled={disabled || checking}
            onClick={() => onReview(verifiedTarget)}
          >
            {t('creation.github.templateBackup.review')}
          </Button>
        )}
      </DialogFooter>
    </>
  )
}
