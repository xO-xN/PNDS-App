import { describe, it, expect, vi, beforeEach } from 'vitest'
import { openProject } from '@/lib/open-project'
import { installAndOpenBundle } from '@/lib/bundle-project'
import type * as bundleProjectModule from '@/lib/bundle-project'
import { importSetlistDirectory } from '@/lib/setlist-import'
import { handleDroppedPaths } from './drag-drop'

vi.mock('@/lib/open-project', () => ({
  openProject: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/setlist-import', () => ({
  importSetlistDirectory: vi.fn().mockResolvedValue(false),
}))

// Keep the real `isBundlePath` routing check; only the install flow is
// stubbed (it would otherwise IPC into the mocked bindings).
vi.mock('@/lib/bundle-project', async importOriginal => {
  const actual = await importOriginal<typeof bundleProjectModule>()
  return {
    ...actual,
    installAndOpenBundle: vi.fn().mockResolvedValue(undefined),
  }
})

/**
 * v1.2.0 (issue #16): a Finder drop routes exactly like the ⌘O picker —
 * `.pnds` files install first, everything else goes to the plain open
 * flow (whose preflight produces the readable error for junk drops).
 * v1.4.0 (#63): a directory holding a set.json routes to the setlist
 * import instead.
 */
describe('handleDroppedPaths', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  it('opens a dropped directory through the normal project flow', async () => {
    await handleDroppedPaths(['/Users/test/Score 4'])

    expect(installAndOpenBundle).not.toHaveBeenCalled()
    expect(openProject).toHaveBeenCalledWith('/Users/test/Score 4')
  })

  it('installs a dropped .pnds bundle (case-insensitive)', async () => {
    await handleDroppedPaths(['/Users/test/score-4-1.0.0.PNDS'])

    expect(installAndOpenBundle).toHaveBeenCalledWith(
      '/Users/test/score-4-1.0.0.PNDS'
    )
    expect(openProject).not.toHaveBeenCalled()
  })

  it('imports a dropped setlist export directory (#63)', async () => {
    vi.mocked(importSetlistDirectory).mockResolvedValue(true)

    await handleDroppedPaths(['/Volumes/Handover/Gig Export'])

    expect(importSetlistDirectory).toHaveBeenCalledWith(
      '/Volumes/Handover/Gig Export'
    )
    expect(installAndOpenBundle).not.toHaveBeenCalled()
    expect(openProject).not.toHaveBeenCalled()
  })

  it('processes multiple drops sequentially, first to last', async () => {
    const order: string[] = []
    vi.mocked(installAndOpenBundle).mockImplementation(async path => {
      order.push(`bundle:${path}`)
    })
    vi.mocked(openProject).mockImplementation(async path => {
      order.push(`project:${path}`)
    })
    vi.mocked(importSetlistDirectory).mockImplementation(async path => {
      order.push(`setlist:${path}`)
      return path === '/Set Export'
    })

    await handleDroppedPaths(['/a.pnds', '/Set Export', '/Score 4', '/b.pnds'])

    expect(order).toEqual([
      'bundle:/a.pnds',
      'setlist:/Set Export',
      // A plain directory is probed too, then falls through to open.
      'setlist:/Score 4',
      'project:/Score 4',
      'bundle:/b.pnds',
    ])
  })

  it('does nothing for an empty drop', async () => {
    await handleDroppedPaths([])

    expect(installAndOpenBundle).not.toHaveBeenCalled()
    expect(openProject).not.toHaveBeenCalled()
  })
})
