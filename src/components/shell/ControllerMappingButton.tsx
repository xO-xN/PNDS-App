import { Cable } from 'lucide-react'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { commands, type ControllerScope } from '@/lib/tauri-bindings'
import {
  updateControllerMapping,
  useControllerMappingStore,
} from '@/store/controller-mapping-store'

export function ControllerMappingButton({
  role,
}: {
  role: ControllerScope['role'] | null
}) {
  const { t } = useTranslation()
  const page = useControllerMappingStore(state =>
    role !== null && state.snapshot?.scope?.role === role
      ? state.snapshot.page
      : null
  )
  const learning = useControllerMappingStore(
    state => page !== null && (state.snapshot?.learning ?? false)
  )
  const pending = useControllerMappingStore(state => state.snapshot?.pending)
  const [busy, setBusy] = useState(false)
  const label = t('controllerMapping.title')
  const prompt = learning
    ? t(
        pending
          ? 'controllerMapping.waitForInput'
          : 'controllerMapping.pickTarget'
      )
    : undefined
  return (
    <button
      type="button"
      className="desktop-summary desktop-controller-mapping pnds-focus-ring"
      data-tauri-drag-region="false"
      aria-label={label}
      aria-pressed={learning}
      disabled={page === null || busy}
      title={prompt ?? label}
      onClick={async () => {
        if (page === null) return
        setBusy(true)
        await updateControllerMapping(
          commands.setControllerLearning(page, !learning)
        )
        setBusy(false)
      }}
    >
      <Cable aria-hidden="true" />
      <span className="desktop-controller-label">{label}</span>
      {prompt && (
        <small className="desktop-optional-label" role="status">
          {prompt}
        </small>
      )}
    </button>
  )
}
