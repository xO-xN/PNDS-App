import { currentResolvedLanguage } from '@/i18n/config'
import {
  selectCompileUnavailableReason,
  useCreationCompileStore,
} from '@/store/creation-compile-store'
import {
  isCreationWorkspacePath,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { currentColorThemeSetting } from '@/store/settings-store'

export function getCreationConsoleSnapshot() {
  const workspace = useCreationStore.getState().workspace
  if (!workspace) return null
  const { error, runtimeError, log } = useCreationTestStore.getState()
  const {
    busy,
    report,
    error: compileError,
  } = useCreationCompileStore.getState()
  const facts = useSessionStore.getState()
  const ownsRuntime = isCreationWorkspacePath(facts.sessionProjectPath)
  return {
    identity: workspace.project.identity,
    editable: workspace.project.source === 'folder',
    log,
    error,
    runtimeError,
    compiling: busy,
    compileReport: report,
    compileError,
    pending: useCreationFilesStore.getState().pending,
    compileReason: selectCompileUnavailableReason(),
    copyDetails: JSON.stringify(
      {
        project: workspace.project.root,
        commandError: error,
        runtimeError,
        compilation: report,
        compilationError: compileError,
        runtime:
          ownsRuntime || facts.sessionStatus === 'idle'
            ? {
                status: facts.sessionStatus,
                projectPath: ownsRuntime ? facts.sessionProjectPath : null,
                audioMode: ownsRuntime ? facts.latestSnapshot?.audioMode : null,
                lanIp: ownsRuntime ? facts.sessionLanIp : null,
                hostAddress: ownsRuntime ? facts.sessionHostAddress : null,
                oscTarget: ownsRuntime ? facts.oscTarget : null,
                health:
                  ownsRuntime &&
                  facts.latestSnapshot?.status === facts.sessionStatus
                    ? facts.health
                    : null,
              }
            : null,
        outputTail: log,
      },
      null,
      2
    ),
    theme: currentColorThemeSetting(),
    locale: currentResolvedLanguage(),
  }
}

export type CreationConsoleSnapshot = NonNullable<
  ReturnType<typeof getCreationConsoleSnapshot>
>
