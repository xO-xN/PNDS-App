import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { GithubNewRepositoryTarget } from '@/lib/tauri-bindings'
import {
  CreationGitHubAccount,
  GithubErrorNotice,
} from './CreationGitHubAccount'
import {
  refreshGithubAuth,
  setGithubAccount,
  useGithubAuth,
} from './creation-github-data'
import {
  suggestedRepositoryName,
  useRepositoryOwners,
  validRepositoryName,
} from './creation-new-repository'

export function CreationGitHubRouteUpload({
  projectName,
  branch,
  head,
  current,
  disabled,
  onCancel,
  onManage,
  onUpload,
}: {
  projectName: string
  branch: string
  head: string
  current: boolean
  disabled: boolean
  onCancel: () => void
  onManage: () => void
  onUpload: (target: GithubNewRepositoryTarget) => void
}) {
  const { t } = useTranslation()
  const { status: auth, error: authError } = useGithubAuth(true)
  const account = auth?.account
  const catalog = useRepositoryOwners(account?.id ?? null)
  const [selectedOwner, setSelectedOwner] = useState<{
    accountId: string
    owner: string
  } | null>(null)
  const [name, setName] = useState(() => suggestedRepositoryName(projectName))
  const [privateRepository, setPrivateRepository] = useState(false)
  const [browserError, setBrowserError] = useState<unknown>(null)
  const owner =
    selectedOwner?.accountId === account?.id
      ? selectedOwner?.owner
      : account?.login
  const repositoryName = name.trim()
  const allowed = catalog.owners?.some(
    candidate => candidate.toLowerCase() === owner?.toLowerCase()
  )
  const target =
    account && owner && allowed && validRepositoryName(repositoryName)
      ? {
          accountId: account.id,
          owner,
          name: repositoryName,
          private: privateRepository,
        }
      : null
  const manageAccess = () => {
    if (auth?.installationUrl)
      void openUrl(auth.installationUrl).catch(setBrowserError)
  }

  return (
    <>
      <div className="grid gap-2 text-sm">
        <p>
          <code dir="ltr">
            {branch} @ {head.slice(0, 12)}
          </code>
        </p>
        <p>{t('creation.github.routeUpload.history')}</p>
        {!current && (
          <GithubErrorNotice error={{ type: 'confirmationExpired' }} />
        )}
      </div>
      {account ? (
        <fieldset
          disabled={disabled || !current}
          className="grid gap-3 text-sm"
        >
          <label className="grid gap-1">
            {t('creation.newProject.repositoryOwner')}
            <Select
              dir="ltr"
              value={owner ?? ''}
              onValueChange={owner =>
                setSelectedOwner({ accountId: account.id, owner })
              }
            >
              <SelectTrigger
                className="w-full"
                aria-label={t('creation.newProject.repositoryOwner')}
              >
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {[...new Set([account.login, ...(catalog.owners ?? [])])].map(
                  login => (
                    <SelectItem key={login} value={login}>
                      {login}
                    </SelectItem>
                  )
                )}
              </SelectContent>
            </Select>
          </label>
          <label className="grid gap-1">
            {t('creation.newProject.repositoryName')}
            <Input
              dir="ltr"
              maxLength={100}
              value={name}
              onChange={event => setName(event.target.value)}
              aria-invalid={!validRepositoryName(repositoryName)}
              autoCapitalize="none"
              autoCorrect="off"
              spellCheck={false}
            />
          </label>
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={privateRepository}
              onChange={event => setPrivateRepository(event.target.checked)}
            />
            {t('creation.github.routeUpload.makePrivate')}
          </label>
          {owner && repositoryName && (
            <p className="flex flex-wrap gap-2">
              <strong dir="ltr" className="break-all">
                {owner}/{repositoryName}
              </strong>
              <span>
                {t(
                  privateRepository
                    ? 'creation.github.private'
                    : 'creation.github.public'
                )}
              </span>
            </p>
          )}
          {catalog.error !== null && (
            <GithubErrorNotice error={catalog.error} />
          )}
          {browserError !== null && <GithubErrorNotice error={browserError} />}
          {catalog.owners && !allowed && (
            <GithubErrorNotice error={{ type: 'accessDenied' }} />
          )}
          {!allowed && (
            <div className="flex flex-wrap gap-2">
              {auth?.installationUrl && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={manageAccess}
                >
                  {t('creation.github.manageRepositories')}
                </Button>
              )}
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={catalog.refresh}
              >
                {t('creation.github.refresh')}
              </Button>
            </div>
          )}
        </fieldset>
      ) : (
        <CreationGitHubAccount
          status={auth}
          error={authError}
          onRefresh={() => void refreshGithubAuth()}
          onConnected={setGithubAccount}
        />
      )}
      <DialogFooter>
        <Button
          type="button"
          variant="ghost"
          disabled={disabled}
          onClick={onManage}
        >
          {t('creation.github.settings')}
        </Button>
        <Button
          type="button"
          variant="outline"
          disabled={disabled}
          onClick={onCancel}
        >
          {t('creation.cancel')}
        </Button>
        <Button
          type="button"
          disabled={disabled || !current || !target}
          onClick={() => {
            if (target) onUpload(target)
          }}
        >
          {t(
            privateRepository
              ? 'creation.github.routeUpload.uploadPrivate'
              : 'creation.github.routeUpload.uploadPublic'
          )}
        </Button>
      </DialogFooter>
    </>
  )
}
