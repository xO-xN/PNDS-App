import { SYSTEM_DEFAULT_DEVICE } from '@/lib/preferences'
import type { CreationProject, SessionSnapshot } from '@/lib/tauri-bindings'

/** The ready runtime may report a launch path that aliases the open workspace. */
export function creationTestOutput(
  project: Pick<CreationProject, 'root'> | null | undefined,
  runtimeProject: { root: string; path: string } | null,
  snapshot: SessionSnapshot | null,
  selection: string
) {
  const runningHere =
    project &&
    snapshot?.status === 'ready' &&
    snapshot.audioMode === 'internal' &&
    (snapshot.projectPath === project.root ||
      (runtimeProject?.root === project.root &&
        runtimeProject.path === snapshot.projectPath))
  if (runningHere && snapshot.outputDevice) return snapshot.outputDevice
  return selection === SYSTEM_DEFAULT_DEVICE ? null : selection
}

export function timeLabel(ms: number) {
  const seconds = Math.floor(ms / 1_000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}
