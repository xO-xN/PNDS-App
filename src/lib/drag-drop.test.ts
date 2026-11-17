import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { PhysicalPosition } from '@tauri-apps/api/dpi'
import { openProject } from '@/lib/open-project'
import { installAndOpenBundle } from '@/lib/bundle-project'
import type * as bundleProjectModule from '@/lib/bundle-project'
import { importSetlistDirectory } from '@/lib/setlist-import'
import { commands } from '@/lib/tauri-bindings'
import { useCreationPendingStore } from '@/store/creation-pending-store'
import { useCreationStore } from '@/store/creation-store'
import { handleDroppedPaths, handleFileDrag } from './drag-drop'

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

describe('Finder drops in the creation workspace', () => {
  const openCreation = vi.fn()
  const originalOpen = useCreationStore.getState().open
  const position = new PhysicalPosition(80, 260)
  const elementFromPoint = vi.fn<typeof document.elementFromPoint>()
  const section = document.createElement('section')
  const button = document.createElement('button')

  beforeEach(() => {
    vi.clearAllMocks()
    section.dataset.creationInbox = 'score'
    section.append(button)
    document.body.append(section)
    elementFromPoint.mockReturnValue(button)
    Object.defineProperty(document, 'elementFromPoint', {
      configurable: true,
      value: elementFromPoint,
    })
    useCreationStore.setState({
      active: true,
      workspace: {
        project: {
          identity: 'score',
          root: '/score',
          name: 'Score',
          source: 'folder',
        },
        files: [],
      },
      open: openCreation,
    })
    useCreationPendingStore.getState().reset('score')
  })

  afterEach(() => {
    section.remove()
    section.removeAttribute('data-creation-inbox-disabled')
    section.removeAttribute('data-creation-inbox-drag-over')
    section.removeAttribute('data-assistant-reference-drop')
    section.removeAttribute('data-assistant-reference-drag-over')
    Reflect.deleteProperty(document, 'elementFromPoint')
    useCreationStore.setState({
      active: false,
      workspace: null,
      open: originalOpen,
    })
  })

  it('highlights the inbox and stages valid files even when another file is rejected', async () => {
    const paths = [
      '/finder/unsupported.zip',
      '/finder/image.png',
      '/finder/score.js',
    ]
    const saved = {
      id: 'draft',
      name: 'score.js',
      version: '1',
      size: 0,
      totalCharacters: 0,
    }
    const image = {
      id: 'still',
      name: 'image.png',
      version: '2',
      size: 4,
      mime: 'image/png',
    }
    vi.mocked(commands.importCreationResource)
      .mockResolvedValueOnce({ status: 'error', error: 'unsupportedType' })
      .mockResolvedValueOnce({ status: 'ok', data: image })
      .mockResolvedValueOnce({ status: 'ok', data: saved })

    await handleFileDrag({ type: 'enter', paths, position })
    expect(elementFromPoint).toHaveBeenCalledWith(80, 260)
    expect(section).toHaveAttribute('data-creation-inbox-drag-over')
    await handleFileDrag({ type: 'leave' })
    expect(section).not.toHaveAttribute('data-creation-inbox-drag-over')
    await handleFileDrag({ type: 'over', position })
    expect(section).toHaveAttribute('data-creation-inbox-drag-over')
    await handleFileDrag({ type: 'drop', paths, position })

    expect(section).not.toHaveAttribute('data-creation-inbox-drag-over')
    expect(commands.importCreationResource).toHaveBeenNthCalledWith(
      3,
      'score',
      paths[2]
    )
    expect(useCreationPendingStore.getState()).toMatchObject({
      documents: [saved],
      media: [image],
      activeId: null,
      importing: false,
      importFailures: [{ name: 'unsupported.zip', error: 'unsupportedType' }],
    })
    expect(commands.readCreationPendingDocument).not.toHaveBeenCalled()
    expect(openCreation).not.toHaveBeenCalled()
  })

  it('consumes drops on a disabled inbox and opens projects outside it', async () => {
    section.dataset.creationInboxDisabled = ''
    await handleFileDrag({
      type: 'drop',
      paths: ['/finder/file.txt'],
      position,
    })
    expect(commands.importCreationResource).not.toHaveBeenCalled()
    expect(openCreation).not.toHaveBeenCalled()

    elementFromPoint.mockReturnValue(document.body)
    await handleFileDrag({ type: 'drop', paths: ['/new project'], position })
    expect(openCreation).toHaveBeenCalledWith('/new project')
  })

  it.each([true, false])(
    'does not open a recording drop as a project while creation is %s',
    async active => {
      const panel = document.createElement('div')
      panel.dataset.recordingDrop = ''
      panel.setAttribute('aria-disabled', 'true')
      const icon = document.createElement('span')
      panel.append(icon)
      section.append(panel)
      elementFromPoint.mockReturnValue(icon)
      useCreationStore.setState({ active })

      await handleFileDrag({ type: 'enter', paths: ['/take.json'], position })
      expect(section).not.toHaveAttribute('data-creation-inbox-drag-over')
      await handleFileDrag({ type: 'drop', paths: ['/take.json'], position })
      expect(commands.importCreationResource).not.toHaveBeenCalled()
      expect(openCreation).not.toHaveBeenCalled()
      expect(openProject).not.toHaveBeenCalled()
      expect(importSetlistDirectory).not.toHaveBeenCalled()

      panel.remove()
    }
  )

  it('clears inbox and reference highlights on entering the recording panel and restores normal outside routing', async () => {
    await handleFileDrag({ type: 'enter', paths: ['/take.json'], position })
    expect(section).toHaveAttribute('data-creation-inbox-drag-over')
    const panel = document.createElement('div')
    panel.dataset.recordingDrop = ''
    section.append(panel)
    elementFromPoint.mockReturnValue(panel)
    await handleFileDrag({ type: 'over', position })
    expect(section).not.toHaveAttribute('data-creation-inbox-drag-over')

    section.dataset.assistantReferenceDrop = 'score'
    elementFromPoint.mockReturnValue(button)
    await handleFileDrag({ type: 'over', position })
    expect(section).toHaveAttribute('data-assistant-reference-drag-over')
    elementFromPoint.mockReturnValue(panel)
    await handleFileDrag({ type: 'over', position })
    expect(section).not.toHaveAttribute('data-assistant-reference-drag-over')

    elementFromPoint.mockReturnValue(document.body)
    await handleFileDrag({ type: 'drop', paths: ['/new project'], position })
    expect(openCreation).toHaveBeenCalledWith('/new project')
    panel.remove()
  })

  it('ignores a saved file dropped elsewhere in its own workspace', async () => {
    elementFromPoint.mockReturnValue(document.body)
    useCreationStore.setState(state => ({
      workspace: state.workspace && {
        ...state.workspace,
        files: [
          {
            path: 'public/score.js',
            kind: 'text',
            category: 'system',
            size: 5,
          },
        ],
      },
    }))
    await handleFileDrag({
      type: 'drop',
      paths: ['/score/public/score.js'],
      position,
    })
    expect(openCreation).not.toHaveBeenCalled()
    expect(commands.importCreationResource).not.toHaveBeenCalled()

    await handleFileDrag({ type: 'drop', paths: ['/score-next'], position })
    expect(openCreation).toHaveBeenCalledWith('/score-next')
  })
})
