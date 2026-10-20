import { useTranslation } from 'react-i18next'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useMonitorPreview } from '@/hooks/use-monitor-preview'
import { CreationPerformers } from './CreationPerformers'
import { CreationTestControls } from './CreationTestControls'

export function CreationTestIdle({ hidden = false }: { hidden?: boolean }) {
  const { t } = useTranslation()
  const covered = useCreationTestStore(state => state.debugView !== 'preview')
  const { viewportRef, surfaceStyle } = useMonitorPreview(true)
  return (
    <aside
      data-creation-test-idle=""
      hidden={hidden}
      inert={covered}
      aria-hidden={covered}
      className="creation-monitor-host"
    >
      <CreationTestControls placement="pane" />
      <div className="monitor-surface" style={surfaceStyle}>
        <div className="creation-monitor-strip" hidden>
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
