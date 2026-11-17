import { useTranslation } from 'react-i18next'
import { useMonitorPreview } from '@/hooks/use-monitor-preview'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { CreationPerformers } from './CreationPerformers'
import { CreationTestControls } from './CreationTestControls'
import { CreationMonitorStrip } from './CreationMonitorStrip'

export function CreationTestIdle() {
  const { t } = useTranslation()
  const expanded = useCreationTestStore(state => state.expanded)
  const status = useSessionStore(state => state.sessionStatus)
  const { viewportRef, surfaceStyle } = useMonitorPreview(!expanded)
  return (
    <aside
      id="creation-monitor"
      data-creation-test-idle=""
      className="creation-monitor-host"
    >
      {expanded && <CreationMonitorStrip />}
      <div className="monitor-surface" style={surfaceStyle}>
        <div
          ref={viewportRef}
          className="monitor-page-viewport creation-monitor-placeholder"
        >
          <p role="status">
            {t(
              status === 'starting' || status === 'stopping'
                ? `creation.testStatus.${status}`
                : 'creation.monitorIdle'
            )}
          </p>
        </div>
      </div>
      {!expanded && (
        <>
          <div className="creation-monitor-performers">
            <CreationPerformers />
          </div>
          <CreationTestControls placement="pane" />
        </>
      )}
    </aside>
  )
}
