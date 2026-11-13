import { useState, type MouseEvent } from 'react'
import { useTranslation } from 'react-i18next'
import { openUrl } from '@tauri-apps/plugin-opener'
import { GithubErrorNotice } from './CreationGitHubAccount'

const directoryUrl =
  'https://github.com/search?q=topic%3Apnds-project+is%3Apublic&type=repositories'

export function CreationGitHubPublicDirectory({
  repository,
}: {
  repository: string
}) {
  const { t } = useTranslation()
  const [error, setError] = useState<unknown>(null)
  const open = async (event: MouseEvent<HTMLAnchorElement>) => {
    event.preventDefault()
    setError(null)
    try {
      await openUrl(event.currentTarget.href)
    } catch (cause) {
      setError(cause)
    }
  }
  const repositoryPath = repository
    .split('/')
    .map(segment => encodeURIComponent(segment))
    .join('/')

  return (
    <div className="grid gap-1 border-t border-(--pnds-creation-line) pt-2 text-xs text-muted-foreground">
      <p>{t('creation.github.publicDirectory.hint')}</p>
      <p>{t('creation.github.publicDirectory.indexing')}</p>
      <div className="flex flex-wrap gap-x-3 gap-y-1">
        <a
          href={`https://github.com/${repositoryPath}`}
          onClick={open}
          className="pnds-focus-ring rounded-sm text-primary-text underline-offset-4 hover:underline"
        >
          {t('creation.github.publicDirectory.repository')}
        </a>
        <a
          href={directoryUrl}
          onClick={open}
          className="pnds-focus-ring rounded-sm text-primary-text underline-offset-4 hover:underline"
        >
          {t('creation.github.publicDirectory.browse')}
        </a>
      </div>
      {error !== null && <GithubErrorNotice error={error} />}
    </div>
  )
}
