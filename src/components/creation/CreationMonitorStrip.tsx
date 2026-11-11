import { useTranslation } from 'react-i18next'
import { CreationPerformerLauncher } from './CreationPerformerLauncher'
import { CreationSpectrum, CreationSpectrumStats } from './CreationSpectrum'

export function CreationMonitorStrip() {
  const { t } = useTranslation()
  return (
    <header className="creation-monitor-strip" data-tauri-drag-region="deep">
      <div className="creation-monitor-heading">
        <span className="truncate">
          monitor
          <span className="creation-monitor-mode">{t('creation.title')}</span>
        </span>
        <CreationPerformerLauncher />
      </div>
      <div className="creation-monitor-spectrum" data-tauri-drag-region="false">
        <CreationSpectrum />
      </div>
      <div className="creation-monitor-stats">
        <CreationSpectrumStats />
      </div>
    </header>
  )
}
