import { useTranslation } from 'react-i18next'
import { Maximize2, X } from 'lucide-react'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'

/** Preview controls do not mount manual diagnostic or saved-copy check panels. */
export function CreationDebugPanel({ hidden }: { hidden: boolean }) {
  const { t } = useTranslation()
  const project = useCreationStore(state => state.workspace?.project)
  const expanded = useCreationTestStore(state => state.expanded)
  const blocked = useCreationStore(
    state => state.opening || state.modePhase !== 'idle'
  )
  if (!project) return null
  return (
    <aside
      className="creation-debug-panel"
      hidden={hidden || expanded}
      aria-label={t('creation.debug.preview')}
    >
      <header className="creation-debug-toolbar">
        <strong>{t('creation.debug.preview')}</strong>
        <span className="flex-1" />

        <button
          type="button"
          className="creation-icon-button pnds-focus-ring"
          aria-label={t('creation.expandMonitor')}
          disabled={blocked}
          onClick={() => useCreationTestStore.getState().setExpanded(true)}
        >
          <Maximize2 aria-hidden="true" />
        </button>

        <button
          type="button"
          className="creation-icon-button pnds-focus-ring"
          aria-label={t('creation.debug.hide')}
          onClick={() =>
            useCreationTestStore.getState().setPreviewVisibility('hidden')
          }
        >
          <X aria-hidden="true" />
        </button>
      </header>
    </aside>
  )
}
