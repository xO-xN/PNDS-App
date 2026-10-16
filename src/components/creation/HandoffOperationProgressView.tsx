import { useTranslation } from 'react-i18next'
import type { HandoffOperationProgress } from '@/lib/tauri-bindings'

export function HandoffOperationProgressView({
  progress,
}: {
  progress: HandoffOperationProgress
}) {
  const { t } = useTranslation()
  return (
    <div role="status" className="space-y-1 break-all text-xs">
      <p>{t(`handoff.operation.${progress.phase}`)}</p>
      {progress.path && (
        <>
          <p>
            {progress.path} · {Math.ceil(progress.bytesRead / 1024)} /{' '}
            {Math.ceil(progress.bytesTotal / 1024)} KiB
          </p>
          <progress
            className="block w-full"
            value={progress.bytesRead}
            max={Math.max(1, progress.bytesTotal)}
            aria-label={t('handoff.operation.fileProgress', {
              path: progress.path,
            })}
          />
          <p>{t('handoff.operation.files', { count: progress.files })}</p>
        </>
      )}
    </div>
  )
}
