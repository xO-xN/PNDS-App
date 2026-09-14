import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'

/**
 * v1.5.0 (#125): reading a project's root README for the main area.
 * The backend treats a missing README (and a gone project directory) as
 * `None`; every failure mode (unreadable, oversized, invalid UTF-8, IPC
 * unavailable) lands on `error` with the readable message instead — the
 * two must never collapse, because the panel shows a distinct
 * read-failure state, not the "no README" empty state. The read still
 * never throws: the display routing stays total on every machine.
 *
 * User report after #127: the locale parameter picks a `README.<locale>.md`
 * variant when the project ships one (the App's resolved UI language),
 * falling back to the plain `README.md`.
 */

/** One completed read: exactly one of the fields is non-null. */
export interface ProjectReadmeRead {
  readme: string | null
  error: string | null
}

export async function readProjectReadme(
  path: string,
  locale: string
): Promise<ProjectReadmeRead> {
  const fail = (error: unknown): ProjectReadmeRead => {
    logger.warn('Failed to read project README', { path, error })
    return {
      readme: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  try {
    const result = await commands.readProjectReadme(path, locale)
    if (result.status === 'error') {
      return fail(result.error)
    }
    return { readme: result.data, error: null }
  } catch (error) {
    return fail(error)
  }
}

/**
 * v1.5.0 (README cover page): the project's optional cover image
 * (`cover.png` → `cover.jpg` → `cover.jpeg` → `cover.webp`) as a data
 * URL for the cover band. Same never-throws posture as the README
 * read, but the panel treats a missing or failed cover as "band
 * without the image": the wrapper logs and the page still renders.
 */
export interface ProjectCoverRead {
  cover: string | null
  error: string | null
}

export async function readProjectCover(
  path: string
): Promise<ProjectCoverRead> {
  const fail = (error: unknown): ProjectCoverRead => {
    logger.warn('Failed to read project cover', { path, error })
    return {
      cover: null,
      error: error instanceof Error ? error.message : String(error),
    }
  }
  try {
    const result = await commands.readProjectCover(path)
    if (result.status === 'error') {
      return fail(result.error)
    }
    return { cover: result.data, error: null }
  } catch (error) {
    return fail(error)
  }
}

/**
 * What a markdown link inside a project README may do. Mirrors the help
 * corpus's policy (help-links.ts): a schemed URL leaves via the system
 * browser; everything else — relative `.md` hand-references included —
 * is a dead no-op. The main webview must NEVER navigate on one (user
 * report after #127: a relative `[中文](README.zh-CN.md)` booted the raw
 * file full-screen and stranded the app).
 */
export type ProjectReadmeLinkTarget = { kind: 'external'; url: string } | null

const SCHEME = /^[a-zA-Z][a-zA-Z0-9+.-]*:/

export function resolveProjectReadmeLink(
  href: string
): ProjectReadmeLinkTarget {
  if (href === '') return null
  if (SCHEME.test(href)) return { kind: 'external', url: href }
  return null
}
