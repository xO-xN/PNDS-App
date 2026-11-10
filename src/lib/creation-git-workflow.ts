import { useCreationReadingStore } from '@/store/creation-reading-store'
import i18n from '@/i18n/config'
import {
  commands,
  type GitRecordPreview,
  type GitRecordReceipt,
} from './tauri-bindings'
import { loadPreferences } from './preferences'
import { useCreationStore } from '@/store/creation-store'
import {
  isDraftDirty,
  isCreationWorkspacePath,
  useCreationFilesStore,
} from '@/store/creation-files-store'
import { useSessionStore } from '@/store/session-store'
import {
  useAssistantStore,
  waitForAssistantTaskRetirements,
} from '@/store/assistant-store'
import { useParameterPreviewStore } from '@/store/parameter-preview-store'
import { flushAssistantResume } from './assistant-resume'
import { stopAndReset } from './open-project'
import { useCreationPendingStore } from '@/store/creation-pending-store'

export type GitOperationPhase =
  | 'saving'
  | 'checking'
  | 'recording'
  | 'refreshing'
  | 'switching'
  | 'stopping'
  | 'synchronizing'
  | 'renaming'
  | 'restoring'
  | 'endingTask'

function owner(identity: string) {
  if (
    !useCreationStore.getState().active ||
    useCreationStore.getState().workspace?.project.identity !== identity
  )
    throw new Error(i18n.t('creation.versions.ownerChanged'))
}
function problem(key: string): never {
  throw new Error(i18n.t(`creation.versions.${key}`))
}
export function unfinishedGitTask() {
  const state = useAssistantStore.getState()
  return (
    state.phase !== 'idle' ||
    state.paused ||
    state.canContinue ||
    state.resumeRestored
  )
}
export async function endGitTask(identity: string) {
  owner(identity)
  const unsentInput = useAssistantStore.getState().input
  useAssistantStore.getState().stop()
  useAssistantStore.setState({ input: unsentInput })
  // Drain all queued publication before revoking the native grant and clearing
  // its checkpoint. The native fence rejects late saves from this task.
  await waitForAssistantTaskRetirements()
  await flushAssistantResume()
  owner(identity)
  const result = await commands.endCreationGitAssistantTask(identity)
  if (result.status === 'error') throw result.error
  owner(identity)
  await useAssistantStore.getState().persistHistory()
}
export async function saveGitVersion(
  identity: string,
  name: string,
  branchName: string,
  onProgress?: (phase: GitOperationPhase) => void
): Promise<{ receipt: GitRecordReceipt | null; preview: GitRecordPreview }> {
  owner(identity)
  onProgress?.('saving')
  if (!(await useCreationPendingStore.getState().saveAll()))
    problem('draftBlocked')
  owner(identity)
  const store = useCreationFilesStore
  if (!(await store.getState().poll()))
    throw (
      store.getState().error ??
      new Error(i18n.t('creation.versions.syncFailed'))
    )
  owner(identity)
  const drafts = Object.entries(store.getState().drafts).filter(([, draft]) =>
    isDraftDirty(draft)
  )
  for (const [path, draft] of drafts) {
    if (draft.conflict || draft.diskChanged || draft.saving || draft.renaming)
      problem('draftBlocked')
    await store.getState().save(path)
    owner(identity)
    const current = store.getState().drafts[path]
    if (!current || isDraftDirty(current) || current.error || current.conflict)
      throw (
        current?.error ?? new Error(i18n.t('creation.versions.draftBlocked'))
      )
  }
  if (Object.values(store.getState().drafts).some(isDraftDirty))
    problem('draftBlocked')
  onProgress?.('checking')
  const result = await commands.previewCreationGitRecord(identity)
  if (result.status === 'error') throw result.error
  owner(identity)
  const preview = result.data
  if (preview.files.some(file => file.staged)) problem('stagedBlocked')
  const paths = preview.files
    .filter(file => file.defaultSelected)
    .map(file => file.path)
  if (!paths.length) return { receipt: null, preview }
  const prefs = await loadPreferences()
  owner(identity)
  let message = name.trim()
  if (!message) {
    if (preview.head) {
      const versions = await commands.getCreationGitVersions(identity, 0)
      owner(identity)
      if (versions.status === 'error') throw versions.error
      message =
        versions.data.nextName ?? i18n.t('creation.versions.defaultName')
    } else message = i18n.t('creation.versions.defaultName')
  }
  onProgress?.('recording')
  const saved = await commands.confirmCreationGitVersion(
    identity,
    preview.token,
    {
      paths,
      name: prefs?.gitName?.trim() || preview.name,
      email: prefs?.gitEmail?.trim() || preview.email,
      message,
    },
    branchName.trim() || null
  )
  if (saved.status === 'error') throw saved.error
  useCreationReadingStore.getState().gitChanged()
  return { receipt: saved.data, preview }
}
export async function switchGitVersion(
  identity: string,
  commit: string,
  discard: boolean,
  branch?: string,
  onProgress?: (phase: GitOperationPhase) => void
) {
  owner(identity)
  if (unfinishedGitTask()) problem('taskBlocked')
  const store = useCreationFilesStore
  const captured = store.getState().drafts
  if (!discard && Object.values(captured).some(isDraftDirty))
    problem('draftBlocked')
  if (Object.values(captured).some(draft => draft.saving || draft.renaming))
    problem('draftBlocked')
  if (!(await useParameterPreviewStore.getState().end()))
    problem('previewBlocked')
  owner(identity)
  const session = useSessionStore.getState()
  if (
    session.commandPending ||
    ['starting', 'stopping'].includes(session.sessionStatus)
  )
    problem('runtimeBusy')
  if (session.sessionStatus === 'ready') {
    if (!isCreationWorkspacePath(session.sessionProjectPath))
      problem('runtimeBusy')
    onProgress?.('stopping')
    await stopAndReset()
    owner(identity)
    if (useSessionStore.getState().sessionStatus !== 'idle')
      problem('runtimeBusy')
  }
  onProgress?.('switching')
  const preview = branch
    ? await commands.previewCreationGitBranchSwitch(
        identity,
        branch,
        commit,
        discard
      )
    : await commands.previewCreationGitSwitch(identity, commit, discard)
  if (preview.status === 'error') throw preview.error
  owner(identity)
  // A newer editor operation cannot be implicitly discarded by an older dialog.
  if (
    Object.entries(store.getState().drafts).some(
      ([path, draft]) => isDraftDirty(draft) && draft !== captured[path]
    )
  )
    problem('draftBlocked')
  const result = await commands.confirmCreationGitSwitch(
    identity,
    preview.data.token
  )
  if (result.status === 'error') throw result.error
  owner(identity)
  onProgress?.('synchronizing')
  useCreationReadingStore.getState().gitChanged()
  // Saved editor copies can refer to files removed by checkout too. Evict only
  // captured copies of affected paths (and explicitly discarded dirty drafts),
  // so synchronization cannot revive them as recoverable unsaved changes.
  const replaced = new Set(preview.data.paths)
  store.setState(state => ({
    drafts: Object.fromEntries(
      Object.entries(state.drafts).filter(
        ([path, draft]) =>
          draft !== captured[path] ||
          (!replaced.has(path) && !(discard && isDraftDirty(draft)))
      )
    ),
  }))
  // Existing sync owns inventory, fresh disk versions and editor resets. It
  // preserves any newer draft rather than marking cumulative task edits again.
  const synchronized = await store.getState().synchronizeSaved(identity)
  return { synchronized }
}
