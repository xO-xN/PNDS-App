import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { DialogFooter } from '@/components/ui/dialog'
import {
  CreationGitHubAccount,
  GithubErrorNotice,
} from './CreationGitHubAccount'
import { CreationGitHubRepositoryField } from './CreationGitHubRepositoryField'
import {
  refreshGithubAuth,
  setGithubAccount,
  useGithubAuth,
  useGithubRepositories,
  type GithubSyncStatus,
} from './creation-github-data'

export function CreationGitHubBind({
  status,
  busy,
  error,
  reconnect,
  onCancel,
  onBind,
}: {
  status: GithubSyncStatus
  busy: boolean
  error: unknown
  reconnect: boolean
  onCancel: () => void
  onBind: (fullName: string, expectedRepositoryId: string | null) => void
}) {
  const { t } = useTranslation()
  const { status: auth, error: authError } = useGithubAuth(true)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [reconnected, setReconnected] = useState(false)
  const account = reconnect && !reconnected ? null : auth?.account
  const catalog = useGithubRepositories(account?.id ?? null)
  const repositories = (catalog.repositories ?? []).filter(
    repo =>
      repo.canPush &&
      (repo.id !== status.repository?.id ||
        status.accountId !== account?.id ||
        !status.repository?.canPush ||
        reconnected)
  )
  const origin = repositories.find(
    repo => repo.fullName.toLowerCase() === status.origin?.toLowerCase()
  )
  const suggested =
    origin ?? repositories.find(repo => repo.id === status.repository?.id)
  const selected = repositories.find(
    repo => repo.id === (selectedId ?? suggested?.id)
  )
  return (
    <>
      <fieldset disabled={busy}>
        {auth && account ? (
          <CreationGitHubRepositoryField
            auth={auth}
            catalog={catalog}
            repositories={repositories}
            selected={selected?.id ?? ''}
            onSelect={setSelectedId}
            createRepository
          />
        ) : (
          <CreationGitHubAccount
            status={auth}
            error={authError}
            onRefresh={() => void refreshGithubAuth()}
            onConnected={connected => {
              setGithubAccount(connected)
              setReconnected(true)
            }}
          />
        )}
      </fieldset>
      {selected && origin?.id === selected.id && selectedId === null && (
        <p className="text-xs text-muted-foreground">
          {t('creation.github.suggestedRepository', {
            repository: selected.fullName,
          })}
        </p>
      )}
      {selected && (
        <p className="text-xs text-muted-foreground">
          {t(
            selected.private
              ? 'creation.github.private'
              : 'creation.github.public'
          )}
        </p>
      )}
      {error !== null && <GithubErrorNotice error={error} />}
      <DialogFooter>
        <Button
          type="button"
          variant="outline"
          disabled={busy}
          onClick={onCancel}
        >
          {t('creation.cancel')}
        </Button>
        <Button
          type="button"
          disabled={busy || !selected}
          onClick={() => {
            if (selected)
              onBind(selected.fullName, status.repository?.id ?? null)
          }}
        >
          {t(
            status.repository
              ? 'creation.github.confirmChangeRepository'
              : 'creation.github.bindRepository'
          )}
        </Button>
      </DialogFooter>
    </>
  )
}
