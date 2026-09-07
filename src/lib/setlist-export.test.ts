import { describe, it, expect, vi, beforeEach } from 'vitest'
import { open } from '@tauri-apps/plugin-dialog'
import { revealItemInDir } from '@tauri-apps/plugin-opener'
import { commands } from '@/lib/tauri-bindings'
import { notifications } from '@/lib/notifications'
import { useProjectStore } from '@/store/project-store'
import { exportSetlistFolder } from './setlist-export'

vi.mock('@tauri-apps/plugin-opener', () => ({
  revealItemInDir: vi.fn().mockResolvedValue(undefined),
}))

vi.mock('@/lib/notifications', () => ({
  notifications: {
    error: vi.fn(),
    success: vi.fn(),
    info: vi.fn(),
    warning: vi.fn(),
  },
}))

const PATH_A = '/bundles/proj-a-1.0.0'
const PATH_B = '/Users/test/Project B'

const INFO_A = {
  path: PATH_A,
  id: 'proj-a',
  version: '1.0.0',
  defaultAudioMode: 'internal',
  fileName: 'Project A-1.0.0.pnds',
}
const INFO_B = {
  path: PATH_B,
  id: 'proj-b',
  version: '2.0.0',
  defaultAudioMode: 'external',
  fileName: 'Project B-2.0.0.pnds',
}

/**
 * v1.4.0 (issue #59): the export flow — picker → describe (the
 * packability gate) → set.json assembly → Rust pack & write → success
 * toast + Finder reveal. Asserted from the outside: the command calls
 * and the serialized set.json the Rust side receives.
 */
describe('exportSetlistFolder (issue #59)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(open).mockResolvedValue('/Users/test/Desktop/Gig Export')
    useProjectStore.setState({
      currentProject: null,
      projectFolders: [
        // Folder order is the set order: B leads.
        { id: 'folder-1', name: 'Gig Friday', projectPaths: [PATH_B, PATH_A] },
        // The protected folder exists but exports nothing (app content).
        { id: 'utilities', name: 'Utilities', projectPaths: [] },
      ],
      projectDisplayNames: { [PATH_B]: 'Night Set' },
      manifestProjectNames: { [PATH_A]: 'Project A' },
      pendingPreflightPath: null,
      preflightStatus: 'idle',
      preflightError: null,
    })
  })

  it('exports the folder in order: set.json entries, README text, reveal', async () => {
    vi.mocked(commands.getSetlistExportInfo).mockResolvedValue({
      status: 'ok',
      data: [INFO_B, INFO_A],
    })
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: {
        theme: 'system',
        oscTargets: { 'proj-b': '10.0.0.5:3333' },
      } as never,
    })

    await exportSetlistFolder('folder-1')

    // The picker offered directories only.
    expect(open).toHaveBeenCalledWith(
      expect.objectContaining({ directory: true, multiple: false })
    )
    // Describe ran the packability gate over the folder order.
    expect(commands.getSetlistExportInfo).toHaveBeenCalledWith([PATH_B, PATH_A])

    const exportCall = vi.mocked(commands.exportSetlist).mock.calls[0]
    if (!exportCall) throw new Error('Expected the export command to run')
    const [destDir, setlistJson, instructions, projectPaths] = exportCall
    expect(destDir).toBe('/Users/test/Desktop/Gig Export')
    expect(projectPaths).toEqual([PATH_B, PATH_A])

    // The serialized set.json: folder name, folder order, the app's one
    // naming rule for display names, manifest audio modes, and the saved
    // OSC target for exactly the project that has one.
    const setlist = JSON.parse(setlistJson)
    expect(setlist).toEqual({
      formatVersion: 1,
      name: 'Gig Friday',
      exportedWith: __APP_VERSION__,
      exportedAt: expect.any(String),
      projects: [
        {
          file: 'Project B-2.0.0.pnds',
          id: 'proj-b',
          version: '2.0.0',
          displayName: 'Night Set',
          audioMode: 'external',
          oscTarget: '10.0.0.5:3333',
        },
        {
          file: 'Project A-1.0.0.pnds',
          id: 'proj-a',
          version: '1.0.0',
          displayName: 'Project A',
          audioMode: 'internal',
        },
      ],
    })

    // The README is localized text naming the set and its size.
    expect(instructions).toContain('Gig Friday')
    expect(instructions).toContain('2')

    expect(notifications.success).toHaveBeenCalledWith(
      'Setlist exported',
      '/tmp/setlist-export'
    )
    expect(revealItemInDir).toHaveBeenCalledWith('/tmp/setlist-export')
  })

  it('a cancelled picker writes nothing', async () => {
    vi.mocked(open).mockResolvedValue(null)

    await exportSetlistFolder('folder-1')

    expect(commands.getSetlistExportInfo).not.toHaveBeenCalled()
    expect(commands.exportSetlist).not.toHaveBeenCalled()
    expect(notifications.success).not.toHaveBeenCalled()
  })

  it('a failing pre-flight names the error and writes nothing', async () => {
    vi.mocked(commands.getSetlistExportInfo).mockResolvedValue({
      status: 'error',
      error: '/Users/test/Project B: Project dependencies are missing',
    })

    await exportSetlistFolder('folder-1')

    expect(notifications.error).toHaveBeenCalledWith(
      'The setlist cannot be exported',
      '/Users/test/Project B: Project dependencies are missing'
    )
    expect(commands.exportSetlist).not.toHaveBeenCalled()
  })

  it('the same project identity twice is refused before writing', async () => {
    vi.mocked(commands.getSetlistExportInfo).mockResolvedValue({
      status: 'ok',
      data: [INFO_B, { ...INFO_B, path: PATH_A, fileName: 'Copy-2.0.0.pnds' }],
    })

    await exportSetlistFolder('folder-1')

    expect(notifications.error).toHaveBeenCalledWith(
      'The folder holds the same project twice (proj-b 2.0.0) — remove one copy before exporting.'
    )
    expect(commands.exportSetlist).not.toHaveBeenCalled()
  })

  it('two distinct projects sharing a bundle file name are refused', async () => {
    // Different identities, same name+version — the .pnds files would
    // silently overwrite each other in the export directory.
    vi.mocked(commands.getSetlistExportInfo).mockResolvedValue({
      status: 'ok',
      data: [
        INFO_B,
        { ...INFO_A, id: 'proj-a-copy', fileName: INFO_B.fileName },
      ],
    })

    await exportSetlistFolder('folder-1')

    expect(notifications.error).toHaveBeenCalledWith(
      "Two different projects would export as the same file (Project B-2.0.0.pnds) — change one project's manifest name or version before exporting."
    )
    expect(commands.exportSetlist).not.toHaveBeenCalled()
  })

  it('a mid-export failure surfaces the error and never reveals', async () => {
    vi.mocked(commands.getSetlistExportInfo).mockResolvedValue({
      status: 'ok',
      data: [INFO_B, INFO_A],
    })
    vi.mocked(commands.exportSetlist).mockResolvedValue({
      status: 'error',
      error: 'disk full',
    })

    await exportSetlistFolder('folder-1')

    expect(notifications.error).toHaveBeenCalledWith(
      'Setlist export failed',
      'disk full'
    )
    expect(revealItemInDir).not.toHaveBeenCalled()
  })

  it('unknown and protected folders never start the flow', async () => {
    await exportSetlistFolder('missing-folder')
    await exportSetlistFolder('utilities')

    expect(open).not.toHaveBeenCalled()
    expect(commands.exportSetlist).not.toHaveBeenCalled()
  })
})
