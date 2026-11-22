import { Cable } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { commands } from '@/lib/tauri-bindings'
import {
  updateControllerMapping,
  useControllerMappingStore,
} from '@/store/controller-mapping-store'

export function ControllerMappingButton() {
  const { t } = useTranslation()
  const page = useControllerMappingStore(state => state.snapshot?.page)
  const learning = useControllerMappingStore(
    state => state.snapshot?.learning ?? false
  )
  const pending = useControllerMappingStore(state => state.snapshot?.pending)
  const [busy, setBusy] = useState(false)
  if (page == null) return null

  return (
    <button
      type="button"
      className="desktop-summary desktop-controller-mapping pnds-focus-ring"
      data-tauri-drag-region="false"
      aria-label={t('controllerMapping.mode')}
      aria-pressed={learning}
      disabled={busy}
      title={
        learning
          ? t(
              pending
                ? 'controllerMapping.waitForInput'
                : 'controllerMapping.pickTarget'
            )
          : t('controllerMapping.mode')
      }
      onClick={async () => {
        setBusy(true)
        await updateControllerMapping(
          commands.setControllerLearning(page, !learning)
        )
        setBusy(false)
      }}
    >
      <Cable aria-hidden="true" />
      {learning && (
        <span className="desktop-optional-label" role="status">
          {t(
            pending
              ? 'controllerMapping.waitForInput'
              : 'controllerMapping.pickTarget'
          )}
        </span>
      )}
    </button>
  )
}
