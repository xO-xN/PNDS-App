import { useTranslation } from 'react-i18next'
import { useMonitorPreview } from '@/hooks/use-monitor-preview'
import { CreationPerformers } from './CreationPerformers'
import { CreationTestControls } from './CreationTestControls'

export function CreationTestIdle() {
  const { t } = useTranslation()
  const { viewportRef, surfaceStyle } = useMonitorPreview(true)
  return (
    <aside data-creation-test-idle="" className="creation-monitor-host">
      <CreationTestControls />
      <div className="monitor-surface" style={surfaceStyle}>
        <div className="creation-monitor-strip">
          <span>
            monitor
            <span className="creation-monitor-mode">{t('creation.title')}</span>
          </span>
        </div>
        <div
          ref={viewportRef}
          className="monitor-page-viewport creation-monitor-placeholder"
        >
          <p>{t('creation.monitorIdle')}</p>
        </div>
      </div>
      <CreationPerformers />
    </aside>
  )
}
