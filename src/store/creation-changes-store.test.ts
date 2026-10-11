import { beforeEach, describe, expect, it, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from './creation-store'
import { useCreationDraftsStore } from './creation-drafts-store'
import { useCreationChangesStore } from './creation-changes-store'
import { useSessionStore } from './session-store'

const workspace = {
  project: {
    identity: 'watched',
    root: '/draft',
    name: 'Draft',
    source: 'folder' as const,
  },
  files: [
    {
      path: 'public/page.js',
      size: 3,
      kind: 'text' as const,
      category: 'pages' as const,
    },
  ],
}

describe('external disk changes (#155)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useCreationStore.setState({ active: true, workspace: null })
    useCreationStore.setState({ workspace })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/draft',
    })
  })

  it('updates the tree and clean disk text, preserves a dirty draft, and never updates the running version automatically', async () => {
    const drafts = useCreationDraftsStore.getState()
    drafts.loaded('public/page.js', 'old', 'v1')
    drafts.loaded('server.js', 'old server', 's1')
    drafts.edit('server.js', 'my server draft')
    vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
      status: 'ok',
      data: {
        files: [
          ...workspace.files,
          { path: 'added.txt', size: 2, kind: 'text', category: 'system' },
        ],
        changed: ['public/page.js', 'server.js', 'added.txt'],
        revision: 1,
      },
    })
    vi.mocked(commands.readCreationFile).mockImplementation(
      async (_, path) => ({
        status: 'ok',
        data: {
          kind: 'text',
          text: path === 'server.js' ? 'agent server' : 'new page',
          version: 'v2',
        },
      })
    )
    await useCreationChangesStore.getState().poll()
    expect(useCreationStore.getState().workspace?.files).toHaveLength(2)
    expect(
      useCreationDraftsStore.getState().drafts['public/page.js']?.text
    ).toBe('new page')
    expect(useCreationDraftsStore.getState().drafts['server.js']).toMatchObject(
      {
        text: 'my server draft',
        conflict: { text: 'agent server', version: 'v2' },
      }
    )
    expect(useCreationChangesStore.getState().pending.refresh).toBeGreaterThan(
      0
    )
    expect(useCreationChangesStore.getState().pending.restart).toBeGreaterThan(
      0
    )
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.compileProjectSynthdefs).not.toHaveBeenCalled()
    expect(useSessionStore.getState().sessionStatus).toBe('ready')
  })

  it('clears only the captured update kinds and retains newer edits and all draft text', async () => {
    const changes = useCreationChangesStore.getState()
    changes.changed(['public/page.js', 'supercollider/source/synth.scd'])
    const token = await changes.capture('/draft')
    changes.complete(token, 'refresh')
    expect(useCreationChangesStore.getState().pending.refresh).toBe(0)
    expect(useCreationChangesStore.getState().pending.restart).toBeGreaterThan(
      0
    )
    changes.changed(['server.js'])
    changes.complete(token, 'restart')
    expect(useCreationChangesStore.getState().pending.restart).toBeGreaterThan(
      0
    )
    changes.complete(token, 'compile')
    expect(useCreationChangesStore.getState().pending.compile).toBe(0)
    expect(useCreationChangesStore.getState().pending.restart).toBeGreaterThan(
      0
    )
  })

  it('uses trusted canonical runtime identity for a preserved alias and ignores localized README edits', async () => {
    useCreationStore.setState({
      runtimeProject: { path: '/alias', root: '/draft' },
    })
    useCreationChangesStore
      .getState()
      .changed(['README.en.md', 'README.zh-CN.md'])
    expect(useCreationChangesStore.getState().pending.restart).toBe(0)
    useSessionStore.setState({ sessionProjectPath: '/alias' })
    useCreationChangesStore.getState().changed(['public/page.js', 'server.js'])
    expect(useCreationChangesStore.getState().pending.refresh).toBeGreaterThan(
      0
    )
    expect(useCreationChangesStore.getState().pending.restart).toBeGreaterThan(
      0
    )
    expect(
      await useCreationChangesStore.getState().capture('/alias')
    ).not.toBeNull()
    useCreationStore.setState({ runtimeProject: null })
  })

  it('replays a watcher batch that races a rename and keeps the draft attached to the renamed file', async () => {
    useCreationDraftsStore.getState().loaded('public/page.js', 'old', 'v1')
    useCreationDraftsStore.getState().edit('public/page.js', 'my draft')
    let resolveRename!: (
      value: Awaited<ReturnType<typeof commands.renameCreationFile>>
    ) => void
    vi.mocked(commands.renameCreationFile).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolveRename = resolve
        })
    )
    const renamed = useCreationDraftsStore
      .getState()
      .rename('public/page.js', 'public/new.js')
    vi.mocked(commands.pollCreationChanges).mockResolvedValueOnce({
      status: 'ok',
      data: {
        files: [],
        changed: ['public/page.js', 'public/new.js'],
        revision: 1,
      },
    })
    vi.mocked(commands.readCreationFile).mockResolvedValueOnce({
      status: 'error',
      error: { code: 'missing', detail: 'public/page.js' },
    })
    expect(await useCreationChangesStore.getState().poll()).toBe(false)
    resolveRename({ status: 'ok', data: 'public/new.js' })
    await renamed
    expect(
      useCreationDraftsStore.getState().drafts['public/new.js']?.text
    ).toBe('my draft')
    expect(
      useCreationDraftsStore.getState().drafts['public/page.js']
    ).toBeUndefined()
    vi.mocked(commands.readCreationFile)
      .mockReset()
      .mockResolvedValue({
        status: 'error',
        error: { code: 'missing', detail: 'not mocked' },
      })
  })

  it('rejects old-project watcher results and errors while a successful switch clears old prompts', async () => {
    const changes = useCreationChangesStore.getState()
    changes.changed(['server.js'])
    let resolve!: (
      value: Awaited<ReturnType<typeof commands.pollCreationChanges>>
    ) => void
    vi.mocked(commands.pollCreationChanges).mockImplementationOnce(
      () =>
        new Promise(done => {
          resolve = done
        })
    )
    const old = changes.poll()
    useCreationStore.setState({
      workspace: {
        ...workspace,
        project: { ...workspace.project, identity: 'next' },
      },
    })
    resolve({
      status: 'error',
      error: { code: 'missing', detail: 'old error' },
    })
    await old
    expect(useCreationChangesStore.getState().pending).toEqual({
      refresh: 0,
      restart: 0,
      compile: 0,
    })
    expect(useCreationChangesStore.getState().error).toBeNull()
    expect(useCreationStore.getState().workspace?.project.identity).toBe('next')
  })
})
