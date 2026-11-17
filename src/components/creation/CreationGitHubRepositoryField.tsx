import { useId, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { Button } from '@/components/ui/button'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { commands } from '@/lib/tauri-bindings'
import { GithubErrorNotice } from './CreationGitHubAccount'
import {
  setGithubAccount,
  unwrapGithub,
  type GithubAuth,
  type GithubRepository,
  type useGithubRepositories,
} from './creation-github-data'

export function CreationGitHubRepositoryField({
  auth,
  catalog,
  repositories,
  selected,
  onSelect,
  createRepository = false,
}: {
  auth: GithubAuth
  catalog: ReturnType<typeof useGithubRepositories>
  repositories: GithubRepository[]
  selected: string
  onSelect: (repositoryId: string) => void
  createRepository?: boolean
}) {
  const { t } = useTranslation()
  const repositoryId = useId()
  const [error, setError] = useState<unknown>(null)
  const [signingOut, setSigningOut] = useState(false)
  const launch = async (url: string) => {
    setError(null)
    try {
      await openUrl(url)
    } catch (cause) {
      setError(cause)
    }
  }
  const signOut = async () => {
    setError(null)
    setSigningOut(true)
    onSelect('')
    try {
      unwrapGithub(await commands.githubDisconnect())
      setGithubAccount(null)
    } catch (cause) {
      onSelect(selected)
      setError(cause)
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">
          {t('creation.github.signedIn', { login: auth.account?.login })}
        </p>
        <Button
          size="sm"
          variant="ghost"
          type="button"
          disabled={signingOut}
          onClick={() => void signOut()}
        >
          {t('creation.github.signOut')}
        </Button>
      </div>
      {error !== null && <GithubErrorNotice error={error} />}
      {catalog.error !== null && <GithubErrorNotice error={catalog.error} />}
      {catalog.repositories ? (
        repositories.length ? (
          <div className="grid gap-1 text-sm">
            <label htmlFor={repositoryId}>
              {t('creation.github.repository')}
            </label>
            <Select
              value={selected}
              onValueChange={onSelect}
              disabled={signingOut}
            >
              <SelectTrigger id={repositoryId} className="w-full">
                <SelectValue
                  placeholder={t('creation.github.selectRepository')}
                />
              </SelectTrigger>
              <SelectContent>
                {repositories.map(repo => (
                  <SelectItem key={repo.id} value={repo.id} dir="ltr">
                    {repo.fullName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            {t('creation.github.noRepositories')}
          </p>
        )
      ) : catalog.error === null ? (
        <p role="status" className="text-sm text-muted-foreground">
          {t('creation.github.loadingRepositories')}
        </p>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {auth.installationUrl && (
          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={() => void launch(auth.installationUrl ?? '')}
          >
            {t('creation.github.manageRepositories')}
          </Button>
        )}
        {createRepository && (
          <Button
            size="sm"
            variant="outline"
            type="button"
            onClick={() => void launch('https://github.com/new')}
          >
            {t('creation.github.createRepository')}
          </Button>
        )}
        <Button
          size="sm"
          variant="ghost"
          type="button"
          onClick={catalog.refresh}
        >
          {t('creation.github.refreshRepositories')}
        </Button>
      </div>
    </div>
  )
}
