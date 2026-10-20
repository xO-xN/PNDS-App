import { Smartphone } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/components/ui/popover'
import { useCreationPerformersStore } from '@/store/creation-performers-store'
import { CreationPerformers } from './CreationPerformers'

/** Reuses the same device actions in expanded monitor; no extra windows,
 * connections or iframe remounts are caused by opening this panel. */
export function CreationPerformerLauncher() {
  const { t } = useTranslation()
  const count = useCreationPerformersStore(
    state =>
      state.windows.length +
      (state.connections?.clients.filter(
        client =>
          !state.windows.some(window => window.label === client.testClient)
      ).length ?? 0)
  )
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          className="creation-performer-launcher pnds-focus-ring"
          data-tauri-drag-region="false"
        >
          <Smartphone size={14} aria-hidden="true" />
          {t('creation.performers.quickAccess', { count })}
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        className="creation-performer-popover"
        aria-label={t('creation.performers.title')}
      >
        <CreationPerformers />
      </PopoverContent>
    </Popover>
  )
}
