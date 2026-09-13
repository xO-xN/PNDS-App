import { describe, it, expect, beforeEach, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { logger } from '@/lib/logger'
import { readProjectReadme, resolveProjectReadmeLink } from './project-readme'

// The failure paths assert the warn — stub the logger (IPC-free tests).
vi.mock('@/lib/logger', () => ({
  logger: {
    warn: vi.fn(),
  },
}))

/**
 * v1.5.0 (#125): the read wrapper behind the project README panel — a
 * present README round-trips, a missing one is a clean null, and every
 * failure mode (backend error, transport throw) lands on the readable
 * `error` field (never on a throw, never conflated with "missing") so
 * the panel can show the read-failure state and the routing stays
 * total.
 */
describe('readProjectReadme (#125)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('returns the backend README verbatim', async () => {
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'ok',
      data: '# Night Sky',
    })

    expect(await readProjectReadme('/p', 'en')).toEqual({
      readme: '# Night Sky',
      error: null,
    })
  })

  it('returns a clean missing read for the backend None', async () => {
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'ok',
      data: null,
    })

    expect(await readProjectReadme('/p', 'en')).toEqual({
      readme: null,
      error: null,
    })
    expect(logger.warn).not.toHaveBeenCalled()
  })

  it('lands the readable backend error on the error field', async () => {
    vi.mocked(commands.readProjectReadme).mockResolvedValue({
      status: 'error',
      error: 'README.md is too large to render',
    })

    expect(await readProjectReadme('/p', 'en')).toEqual({
      readme: null,
      error: 'README.md is too large to render',
    })
    expect(logger.warn).toHaveBeenCalled()
  })

  it('lands a readable message when the invoke itself throws', async () => {
    vi.mocked(commands.readProjectReadme).mockRejectedValue(
      new Error('IPC unavailable')
    )

    expect(await readProjectReadme('/p', 'en')).toEqual({
      readme: null,
      error: 'IPC unavailable',
    })
    expect(logger.warn).toHaveBeenCalled()
  })
})

/**
 * User report after #127: links inside a project README must never
 * navigate the main webview. Schemed URLs hand off to the system
 * browser; relative references (the README language switcher, hand
 * file links) are dead no-ops.
 */
describe('resolveProjectReadmeLink (user report after #127)', () => {
  it('hands schemed URLs to the system browser', () => {
    expect(resolveProjectReadmeLink('https://example.com/x')).toEqual({
      kind: 'external',
      url: 'https://example.com/x',
    })
    expect(resolveProjectReadmeLink('http://localhost:6868/')).toEqual({
      kind: 'external',
      url: 'http://localhost:6868/',
    })
    expect(resolveProjectReadmeLink('mailto:someone@example.org')).toEqual({
      kind: 'external',
      url: 'mailto:someone@example.org',
    })
  })

  it('no-ops on relative references and empty hrefs', () => {
    // The exact shape that once navigated the webview away (the
    // README language switcher line).
    expect(resolveProjectReadmeLink('README.zh-CN.md')).toBeNull()
    expect(resolveProjectReadmeLink('./PROJECT_HANDSOFF.md')).toBeNull()
    expect(resolveProjectReadmeLink('#section')).toBeNull()
    expect(resolveProjectReadmeLink('')).toBeNull()
  })
})
