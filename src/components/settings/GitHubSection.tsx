import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import {
  CreationGitHubAccount,
  GithubErrorNotice,
} from '@/components/creation/CreationGitHubAccount'
import { CreationGitHubAvatar } from '@/components/creation/CreationGitHubAvatar'
import {
  refreshGithubAuth,
  setGithubAccount,
  unwrapGithub,
  useGithubAuth,
} from '@/components/creation/creation-github-data'
import { Button } from '@/components/ui/button'
import { commands } from '@/lib/tauri-bindings'
import { SettingsGroup } from './SettingsGroup'

export function GitHubSection() {
  const { t } = useTranslation()
  const { status, error } = useGithubAuth(true)
  const [signingOut, setSigningOut] = useState(false)
  const [signOutError, setSignOutError] = useState<unknown>(null)
  const account = status?.account

  const signOut = async () => {
    setSigningOut(true)
    setSignOutError(null)
    try {
      unwrapGithub(await commands.githubDisconnect())
      setGithubAccount(null)
    } catch (cause) {
      setSignOutError(cause)
    } finally {
      setSigningOut(false)
    }
  }

  return (
    <SettingsGroup
      id="settings-section-github"
      title={t('settings.github')}
      description={t('settings.presentation.githubHint')}
    >
      {status && !status.configured ? (
        <p role="status" className="text-sm text-muted-foreground p-3.5">
          {t('settings.github.unconfigured')}
        </p>
      ) : account ? (
        <div className="grid gap-3 p-3.5">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="flex items-center gap-2 text-sm">
              <CreationGitHubAvatar account={account} />
              {t('creation.github.signedIn', { login: account.login })}
            </span>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={signingOut}
              onClick={() => void signOut()}
            >
              {t('creation.github.signOut')}
            </Button>
          </div>
          {signOutError !== null && <GithubErrorNotice error={signOutError} />}
        </div>
      ) : (
        <div className="w-fit max-w-full p-3.5">
          <CreationGitHubAccount
            status={status}
            error={error}
            onRefresh={() => void refreshGithubAuth()}
            onConnected={setGithubAccount}
          />
        </div>
      )}
    </SettingsGroup>
  )
}
