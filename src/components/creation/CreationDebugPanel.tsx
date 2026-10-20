import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import {
  MoreHorizontal,
  Maximize2,
  X,
  Stethoscope,
  FlaskConical,
} from 'lucide-react'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useCreationFilesStore } from '@/store/creation-files-store'
import { useAssistantOverviewStore } from '@/store/assistant-overview-store'
import {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuItem,
} from '@/components/ui/dropdown-menu'
import { CreationDoctor } from './CreationDoctor'
import { CreationControlledCheck } from './CreationControlledCheck'

/** Reports survive navigation and runtime iframe replacement; opening a menu runs nothing. */
export function CreationDebugPanel({ hidden }: { hidden: boolean }) {
  const { t } = useTranslation()
  const moreTrigger = useRef<HTMLButtonElement>(null)
  const closeReport = () => {
    useCreationTestStore.getState().setDebugView('preview')
    moreTrigger.current?.focus()
  }
  const project = useCreationStore(state => state.workspace?.project)
  const expanded = useCreationTestStore(state => state.expanded)
  const blocked = useCreationStore(
    state => state.opening || state.modePhase !== 'idle'
  )
  const view = useCreationTestStore(state => state.debugView)
  const visited = useCreationTestStore(state => state.debugVisited)
  const issues = useAssistantOverviewStore(state =>
    state.owner === project?.identity ? (state.staticEvidence?.issues ?? 0) : 0
  )
  const choose = (next: typeof view) => {
    useCreationTestStore.getState().setDebugView(next)
  }
  if (!project) return null
  return (
    <aside
      className="creation-debug-panel"
      hidden={hidden || expanded}
      aria-label={t('creation.debug.title')}
    >
      <header className="creation-debug-toolbar">
        <strong>{t('creation.debug.title')}</strong>
        <button
          type="button"
          className="pnds-focus-ring"
          aria-pressed={view === 'preview'}
          onClick={() => choose('preview')}
        >
          {t('creation.debug.preview')}
        </button>
        {issues > 0 && (
          <button
            type="button"
            className="pnds-focus-ring creation-debug-count"
            onClick={() => choose('static')}
          >
            {t('creation.debug.issues', { count: issues })}
          </button>
        )}
        <span className="flex-1" />
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              disabled={blocked}
              ref={moreTrigger}
              data-creation-doctor=""
              data-creation-controlled-check=""
              className="creation-icon-button pnds-focus-ring"
              aria-label={t('creation.debug.more')}
            >
              <MoreHorizontal aria-hidden="true" />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem onSelect={() => choose('static')}>
              <Stethoscope aria-hidden="true" />
              {t('creation.doctor.action')}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => choose('controlled')}>
              <FlaskConical aria-hidden="true" />
              {t('creation.check.action')}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
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
      <div className="creation-debug-reports" hidden={view === 'preview'}>
        {visited.static && (
          <div hidden={view !== 'static'} className="h-full">
            <CreationDoctor
              identity={project.identity}
              embedded
              onClose={closeReport}
              onOpenFile={path => {
                useCreationFilesStore.getState().setActivePath(path)
                useCreationTestStore.getState().setTab('file')
              }}
            />
          </div>
        )}
        {visited.controlled && (
          <div hidden={view !== 'controlled'} className="h-full">
            <CreationControlledCheck
              identity={project.identity}
              embedded
              open
              onClose={closeReport}
            />
          </div>
        )}
      </div>
    </aside>
  )
}
