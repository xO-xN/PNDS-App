import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { GithubAccount } from './creation-github-data'
import './creation-github.css'

export function CreationGitHubAvatar({ account }: { account: GithubAccount }) {
  const { t } = useTranslation()
  const [failedUrl, setFailedUrl] = useState<string | null>(null)
  return (
    <span
      className="creation-github-avatar"
      title={t('creation.github.signedIn', { login: account.login })}
      aria-hidden="true"
    >
      {account.avatarUrl && failedUrl !== account.avatarUrl ? (
        <img
          src={account.avatarUrl}
          alt=""
          referrerPolicy="no-referrer"
          onError={() => setFailedUrl(account.avatarUrl)}
        />
      ) : (
        account.login.slice(0, 1).toUpperCase()
      )}
    </span>
  )
}
