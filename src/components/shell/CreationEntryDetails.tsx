import { Copy } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { useCreationTestEntry } from '@/hooks/use-creation-test-entry'
import { useCreationStore } from '@/store/creation-store'
import { isCreationWorkspacePath } from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import { performerQrUrl } from '@/lib/performer-qr'
import { notifications } from '@/lib/notifications'
import { logger } from '@/lib/logger'
import { EntryQrImage } from './PublicEntryDetails'

export function CreationEntryDetails() {
  const { t } = useTranslation()
  const { url, generation, status } = useCreationTestEntry()
  const identity = useCreationStore(state => state.workspace?.project.identity)
  return (
    <section
      className="public-entry-details public-entry-compact"
      aria-label={t('creation.testEntry.title')}
    >
      <p className="public-entry-caption">{t('creation.testEntry.title')}</p>
      {url ? (
        <>
          <div className="public-entry-address">
            <bdi dir="ltr" title={url}>
              {url.replace(/^https?:\/\//, '').replace(/\/$/, '')}
            </bdi>
            <button
              type="button"
              className="public-entry-copy pnds-focus-ring"
              aria-label={t('participation.copyEntry')}
              onClick={() => {
                const creation = useCreationStore.getState()
                const current = useSessionStore.getState()
                if (
                  !creation.active ||
                  creation.opening ||
                  creation.modePhase !== 'idle' ||
                  creation.workspace?.project.identity !== identity ||
                  !isCreationWorkspacePath(current.sessionProjectPath) ||
                  current.commandPending ||
                  current.sessionStatus !== 'ready' ||
                  current.latestSnapshot?.runtimeGeneration !== generation ||
                  performerQrUrl(current.latestSnapshot) !== url
                )
                  return
                void writeText(url)
                  .then(() => notifications.success(t('menu.addressCopied')))
                  .catch(error => {
                    logger.warn('Failed to copy test performer address', {
                      error,
                    })
                    notifications.error(t('participation.copyFailed'))
                  })
              }}
            >
              <Copy aria-hidden="true" />
            </button>
          </div>
          <EntryQrImage
            key={`${identity}:${generation}:${url}`}
            url={url}
            generation={generation}
          />
        </>
      ) : (
        <p role={status === 'error' || status === 'ready' ? 'alert' : 'status'}>
          {t(
            status === 'ready'
              ? 'creation.testEntry.unavailable'
              : `creation.testStatus.${status}`
          )}
        </p>
      )}
    </section>
  )
}
