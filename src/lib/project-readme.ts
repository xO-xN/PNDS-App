import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'

/**
 * v1.5.0 (#125): reading a project's root README.md for the main area.
 * The backend treats a missing README (and a gone project directory) as
 * `None`; every failure mode (unreadable, oversized, invalid UTF-8, IPC
 * unavailable) lands on `error` with the readable message instead — the
 * two must never collapse, because the panel shows a distinct
 * read-failure state, not the "no README" empty state. The read still
 * never throws: the display routing stays total on every machine.
 */

/** One completed read: exactly one of the fields is non-null. */
export interface ProjectReadmeRead {
  readme: string | null
  error: string | null
}

export async function readProjectReadme(
  path: string
): Promise<ProjectReadmeRead> {
  const fail = (error: unknown): ProjectReadmeRead => {
    logger.warn('Failed to read project README', { path, error })
    return {
      readme: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  try {
    const result = await commands.readProjectReadme(path)
    if (result.status === 'error') {
      return fail(result.error)
    }
    return { readme: result.data, error: null }
  } catch (error) {
    return fail(error)
  }
}
