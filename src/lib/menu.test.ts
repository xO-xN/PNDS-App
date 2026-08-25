import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { writeText } from '@tauri-apps/plugin-clipboard-manager'
import { MenuItem } from '@tauri-apps/api/menu'
import i18n from '@/i18n/config'
import { commands } from '@/lib/tauri-bindings'
import type { Manifest } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { buildAppMenu, setupMenuStateListener } from './menu'

/**
 * v1.2.0 (issue #13): the menu is built from JS for i18n — these tests pin
 * its structure and actions with the Tauri menu API mocked out: Settings…
 * ⌘, and Add Project… ⌘O exist and work, About routes to the settings
 * panel, Window > Zoom is gone, and the predefined Edit items stay.
 */

interface MenuItemConfig {
  id?: string
  text?: string
  accelerator?: string
  enabled?: boolean
  action?: () => void
}

interface PredefinedItemConfig {
  item: string
  text?: string
}

interface SubmenuConfig {
  text: string
  items: unknown[]
}

interface MenuInstance {
  setAsAppMenu: ReturnType<typeof vi.fn>
}

const captured = vi.hoisted(() => ({
  menuItems: [] as MenuItemConfig[],
  predefinedItems: [] as PredefinedItemConfig[],
  submenus: [] as SubmenuConfig[],
  menuInstances: [] as MenuInstance[],
}))

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: {
    new: vi.fn(async () => {
      const instance: MenuInstance = {
        setAsAppMenu: vi.fn(async () => undefined),
      }
      captured.menuInstances.push(instance)
      return instance
    }),
  },
  Submenu: {
    new: vi.fn(async (config: SubmenuConfig) => {
      captured.submenus.push(config)
      return config
    }),
  },
  MenuItem: {
    new: vi.fn(async (config: MenuItemConfig) => {
      captured.menuItems.push(config)
      return config
    }),
  },
  PredefinedMenuItem: {
    new: vi.fn(async (config: PredefinedItemConfig) => {
      captured.predefinedItems.push(config)
      return config
    }),
  },
}))

const promptOpenProject = vi.hoisted(() => vi.fn())
vi.mock('@/lib/open-project', () => ({
  promptOpenProject,
  openProject: vi.fn(),
  confirmTrustAndOpen: vi.fn(),
  runPreflight: vi.fn(),
  stopAndReset: vi.fn(),
}))

const notificationsMock = vi.hoisted(() => ({
  success: vi.fn(),
  error: vi.fn(),
  info: vi.fn(),
  warning: vi.fn(),
}))
vi.mock('@/lib/notifications', () => ({ notifications: notificationsMock }))

const helpWindowMock = vi.hoisted(() => ({
  openHelpWindow: vi.fn().mockResolvedValue(undefined),
  closeHelpWindow: vi.fn().mockResolvedValue(undefined),
  HELP_WINDOW_LABEL: 'help',
}))
vi.mock('@/lib/help-window', () => helpWindowMock)

/** Custom items by id, asserting presence so callers stay non-null. With
 * store-driven rebuilds the captures hold several builds' items — the
 * LATEST build's entry is the live one. */
function item(id: string): MenuItemConfig {
  const found = [...captured.menuItems].reverse().find(i => i.id === id)
  if (!found) throw new Error(`menu item "${id}" not built`)
  return found
}

function submenuItems(text: string): unknown[] {
  const submenu = [...captured.submenus].reverse().find(s => s.text === text)
  if (!submenu) throw new Error(`submenu "${text}" not built`)
  return submenu.items
}

/** The predefined items that ended up inside a given submenu. */
function predefinedIn(text: string): string[] {
  const items = new Set(submenuItems(text))
  return captured.predefinedItems
    .filter(p => items.has(p as unknown))
    .map(p => p.item)
}

beforeEach(async () => {
  captured.menuItems.length = 0
  captured.predefinedItems.length = 0
  captured.submenus.length = 0
  captured.menuInstances.length = 0
  promptOpenProject.mockClear()
  vi.mocked(writeText).mockClear()
  notificationsMock.success.mockClear()
  useSettingsStore.setState({
    settingsOpen: false,
    focusSection: null,
    languageSetting: 'system',
  })
  await buildAppMenu()
})

describe('buildAppMenu (v1.2.0 issue #13)', () => {
  it('adds a Settings… ⌘, item that toggles the settings panel', () => {
    const settings = item('settings')
    expect(settings.text).toBe('Settings…')
    expect(settings.accelerator).toBe('Cmd+Comma')

    settings.action?.()
    expect(useSettingsStore.getState().settingsOpen).toBe(true)
    settings.action?.()
    expect(useSettingsStore.getState().settingsOpen).toBe(false)
  })

  it('routes About to the settings panel About section (native dialog retired)', () => {
    item('about').action?.()
    const state = useSettingsStore.getState()
    expect(state.settingsOpen).toBe(true)
    expect(state.focusSection).toBe('about')
  })

  it('adds File > Add Project… ⌘O opening the folder picker directly', () => {
    const addProject = item('add-project')
    expect(addProject.text).toBe('Add Project…')
    expect(addProject.accelerator).toBe('Cmd+O')
    expect(submenuItems('File')).toContain(addProject)

    addProject.action?.()
    expect(promptOpenProject).toHaveBeenCalledTimes(1)
  })

  it('keeps the custom ⌘W close-window item in File', () => {
    const closeWindow = item('close-window')
    expect(closeWindow.accelerator).toBe('Cmd+W')
    expect(submenuItems('File')).toContain(closeWindow)
  })

  it('⌘W opens the close-project confirm while a session runs (v1.2.0)', async () => {
    useProjectStore.setState({ confirmCloseProjectOpen: false })
    useSessionStore.setState({ sessionStatus: 'ready' })

    // #56: the action dispatches on the focused window (async).
    item('close-window').action?.()
    await vi.waitFor(() =>
      expect(useProjectStore.getState().confirmCloseProjectOpen).toBe(true)
    )

    expect(commands.closeWindowWithFade).not.toHaveBeenCalled()
    useSessionStore.setState({ sessionStatus: 'idle' })
    useProjectStore.setState({ confirmCloseProjectOpen: false })
  })

  it('⌘W keeps closing the window on the start page', async () => {
    useProjectStore.setState({ confirmCloseProjectOpen: false })
    useSessionStore.setState({ sessionStatus: 'idle' })

    item('close-window').action?.()

    expect(useProjectStore.getState().confirmCloseProjectOpen).toBe(false)
    await vi.waitFor(() =>
      expect(commands.closeWindowWithFade).toHaveBeenCalled()
    )
  })

  it('removes the dead Window > Zoom item but keeps ⌃⌘F fullscreen', () => {
    expect(
      captured.predefinedItems.filter(p => p.item === 'Maximize')
    ).toHaveLength(0)

    const fullscreen = item('toggle-fullscreen')
    expect(fullscreen.accelerator).toBe('Ctrl+Cmd+F')
    expect(submenuItems('Window')).toContain(fullscreen)
  })

  it('keeps the six predefined Edit text items (⌘C/⌘V/⌘A in inputs)', () => {
    expect(predefinedIn('Edit')).toEqual(
      expect.arrayContaining([
        'Undo',
        'Redo',
        'Cut',
        'Copy',
        'Paste',
        'SelectAll',
      ])
    )
  })

  it('keeps the Hide series and custom ⌘Q in the app menu', () => {
    const appMenu = submenuItems('PNDS')
    for (const id of ['about', 'settings', 'check-updates', 'quit-app']) {
      expect(appMenu).toContain(item(id))
    }
    expect(predefinedIn('PNDS')).toEqual(
      expect.arrayContaining(['Hide', 'HideOthers', 'ShowAll'])
    )
    expect(item('quit-app').accelerator).toBe('Cmd+Q')
  })
})

describe('buildAppMenu mute item (v1.2.2, #30 feedback)', () => {
  it('claims ⌘M from the system hide and routes the shared mute entry', () => {
    const mute = item('mute-toggle')
    expect(mute.accelerator).toBe('Cmd+M')
    expect(mute.text).toBe('Mute / Unmute')
    expect(submenuItems('View')).toContain(mute)

    // The action is the shared volume-control toggle: gated to live
    // internal sessions, forwarding 0/restore to the synth.
    useSessionStore.setState({
      sessionStatus: 'ready',
      audioMode: 'internal',
      volume: 70,
      muted: false,
      prevVolume: 0,
    })
    mute.action?.()
    expect(useSessionStore.getState()).toMatchObject({
      volume: 0,
      muted: true,
      prevVolume: 70,
    })
    expect(commands.setMasterVolume).toHaveBeenLastCalledWith(0)

    mute.action?.()
    expect(useSessionStore.getState().volume).toBe(70)
    expect(commands.setMasterVolume).toHaveBeenLastCalledWith(70)

    // Outside a live internal session the accelerator is a silent no-op.
    useSessionStore.setState({ sessionStatus: 'idle', volume: 70 })
    vi.mocked(commands.setMasterVolume).mockClear()
    mute.action?.()
    expect(useSessionStore.getState().muted).toBe(false)
    expect(commands.setMasterVolume).not.toHaveBeenCalled()
    useSessionStore.getState().resetSession()
  })
})

describe('buildAppMenu address segment (v1.3.0, #52)', () => {
  /** Ports away from the 6868/6869 contract defaults — assertions then
   * prove the addresses come from the selected manifest, not a fallback. */
  const addressManifest: Manifest = {
    schemaVersion: 1,
    id: 'demo',
    name: 'Demo Score',
    version: '1.0.0',
    description: null,
    scoreServer: {
      entry: 'server.js',
      workingDirectory: '.',
      performerPort: 7000,
      monitorPort: 7001,
    },
    audio: {
      defaultMode: 'internal',
      supportedModes: ['internal'],
      synthdefs: [],
      scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
      standaloneTarget: null,
    },
  }

  function selectProject(): void {
    useProjectStore.setState({
      currentProject: { path: '/tmp/demo', manifest: addressManifest },
    })
    useSessionStore.setState({ lanIp: '192.168.1.42' })
  }

  afterEach(() => {
    useProjectStore.setState({ currentProject: null })
    useSessionStore.getState().resetSession()
  })

  it('shows both full addresses for a selected project and copies them on click', async () => {
    selectProject()
    await buildAppMenu()

    const performer = item('performer-address')
    const conductor = item('conductor-address')
    expect(performer.text).toBe('Performer — http://192.168.1.42:7000/')
    expect(conductor.text).toBe('Conductor — http://192.168.1.42:7001/')
    expect(performer.enabled).toBe(true)
    expect(conductor.enabled).toBe(true)
    const windowItems = submenuItems('Window')
    expect(windowItems).toContain(performer)
    expect(windowItems).toContain(conductor)

    performer.action?.()
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://192.168.1.42:7000/')
    )
    conductor.action?.()
    await vi.waitFor(() =>
      expect(writeText).toHaveBeenCalledWith('http://192.168.1.42:7001/')
    )
    expect(notificationsMock.success).toHaveBeenCalledWith(
      'Copied: http://192.168.1.42:7000/'
    )
  })

  it('disables the items to bare labels with no selected project', async () => {
    useProjectStore.setState({ currentProject: null })
    useSessionStore.setState({ lanIp: null })
    await buildAppMenu()

    const performer = item('performer-address')
    const conductor = item('conductor-address')
    expect(performer.text).toBe('Performer')
    expect(conductor.text).toBe('Conductor')
    expect(performer.enabled).toBe(false)
    expect(conductor.enabled).toBe(false)

    performer.action?.()
    expect(writeText).not.toHaveBeenCalled()
  })

  it('keeps the items disabled until a LAN address is chosen', async () => {
    useProjectStore.setState({
      currentProject: { path: '/tmp/demo', manifest: addressManifest },
    })
    useSessionStore.setState({ lanIp: null })
    await buildAppMenu()

    const performer = item('performer-address')
    expect(performer.text).toBe('Performer')
    expect(performer.enabled).toBe(false)
  })

  it('follows the LAN choice into the rebuilt addresses', async () => {
    selectProject()
    useSessionStore.getState().setLanIp('10.0.0.7')
    await buildAppMenu()

    expect(item('performer-address').text).toBe(
      'Performer — http://10.0.0.7:7000/'
    )
    expect(item('conductor-address').text).toBe(
      'Conductor — http://10.0.0.7:7001/'
    )
  })

  it('localizes the segment labels with the app language', async () => {
    selectProject()
    try {
      await i18n.changeLanguage('zh-CN')
      await buildAppMenu()

      expect(item('performer-address').text).toBe(
        '演奏者 — http://192.168.1.42:7000/'
      )
      expect(item('conductor-address').text).toBe(
        '指挥 — http://192.168.1.42:7001/'
      )
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('rebuilds via the store listener on selection/LAN changes, not on session noise', async () => {
    const unsubscribe = setupMenuStateListener()
    try {
      useSessionStore.getState().setLanIp('192.168.1.42')
      await vi.waitFor(() =>
        expect(item('performer-address').text).toBe('Performer')
      )

      useProjectStore.setState({
        currentProject: { path: '/tmp/demo', manifest: addressManifest },
      })
      await vi.waitFor(() =>
        expect(item('performer-address').text).toBe(
          'Performer — http://192.168.1.42:7000/'
        )
      )

      useSessionStore.getState().setLanIp('10.0.0.7')
      await vi.waitFor(() =>
        expect(item('performer-address').text).toBe(
          'Performer — http://10.0.0.7:7000/'
        )
      )

      // Unrelated session churn (volume, health snapshots) must not
      // rebuild: the item keeps the LAN-derived address above.
      useSessionStore.getState().setVolume(33)
      useSessionStore.getState().setStartupStage(3)
      await new Promise(resolve => setTimeout(resolve, 50))
      expect(item('performer-address').text).toBe(
        'Performer — http://10.0.0.7:7000/'
      )
    } finally {
      unsubscribe()
    }
  })

  it('never lets a superseded rebuild install its stale menu (last write wins)', async () => {
    selectProject()

    // Build A's first menu item resolves on a macrotask; build B, started
    // right after with all-immediate awaits, overtakes it and installs
    // first — A must then install nothing (its addresses are stale).
    const originalItemNew = vi.mocked(MenuItem.new).getMockImplementation()
    vi.mocked(MenuItem.new).mockImplementationOnce(async opts => {
      await new Promise(resolve => setTimeout(resolve, 20))
      if (!originalItemNew) throw new Error('MenuItem.new base mock missing')
      return originalItemNew(opts)
    })

    const [buildA, buildB] = [buildAppMenu(), buildAppMenu()]
    await Promise.all([buildA, buildB])

    // B finished first, so its Menu instance was captured first; A's
    // late instance must never install over it.
    const [installedB, supersededA] = captured.menuInstances.slice(-2)
    if (!installedB || !supersededA) {
      throw new Error('expected two menu instances from the two builds')
    }
    expect(installedB.setAsAppMenu).toHaveBeenCalledTimes(1)
    expect(supersededA.setAsAppMenu).not.toHaveBeenCalled()
  })
})

/**
 * v1.3.0 (#56): the Help menu — a top-level submenu after Window (the
 * macOS Help position) with the ⌘? search entry and the three document
 * entries, plus the ⌘W dispatch that must act on the FRONT window once
 * a second window (the help center) exists.
 */
describe('buildAppMenu help menu (v1.3.0, #56)', () => {
  it('adds the Help submenu last with the search entry and three documents', () => {
    expect(captured.submenus.map(s => s.text).slice(-2)).toEqual([
      'Window',
      'Help',
    ])

    // ⇧⌘/ is the physical chord behind ⌘? — one accelerator claims both.
    expect(item('help-search')).toMatchObject({
      text: 'Search Help',
      accelerator: 'Cmd+Shift+Slash',
    })
    expect(item('help-tutorial').text).toBe('User Tutorial')
    expect(item('help-creator-guide').text).toBe('Creator Guide')
    expect(item('help-reference').text).toBe('Reference Manual')
    expect(predefinedIn('Help')).toContain('Separator')
  })

  it('localizes the Help menu with the app language', async () => {
    try {
      await i18n.changeLanguage('zh-CN')
      await buildAppMenu()

      expect([...captured.submenus].reverse()[0]?.text).toBe('帮助')
      expect(item('help-search').text).toBe('搜索帮助')
      expect(item('help-tutorial').text).toBe('使用教程')
      expect(item('help-creator-guide').text).toBe('创作指南')
      expect(item('help-reference').text).toBe('参考手册')
    } finally {
      await i18n.changeLanguage('en')
    }
  })

  it('opens the help center on the right target from each entry', () => {
    item('help-search').action?.()
    item('help-tutorial').action?.()
    item('help-creator-guide').action?.()
    item('help-reference').action?.()

    expect(helpWindowMock.openHelpWindow).toHaveBeenNthCalledWith(1, {
      kind: 'search',
    })
    expect(helpWindowMock.openHelpWindow).toHaveBeenNthCalledWith(2, {
      kind: 'doc',
      docId: 'app-tutorial',
    })
    expect(helpWindowMock.openHelpWindow).toHaveBeenNthCalledWith(3, {
      kind: 'doc',
      docId: 'template-guide',
    })
    expect(helpWindowMock.openHelpWindow).toHaveBeenNthCalledWith(4, {
      kind: 'doc',
      docId: 'reference-readme',
    })
  })

  it('routes ⌘W to the focused window', async () => {
    // The help center is front: ⌘W closes it, never the main flow.
    vi.mocked(commands.closeWindowWithFade).mockClear()
    vi.mocked(commands.focusedWindowLabel).mockResolvedValue({
      status: 'ok',
      data: 'help',
    })
    item('close-window').action?.()
    await vi.waitFor(() =>
      expect(helpWindowMock.closeHelpWindow).toHaveBeenCalledTimes(1)
    )
    expect(commands.closeWindowWithFade).not.toHaveBeenCalled()

    // The main window is front: the existing close flow runs.
    helpWindowMock.closeHelpWindow.mockClear()
    vi.mocked(commands.closeWindowWithFade).mockClear()
    vi.mocked(commands.focusedWindowLabel).mockResolvedValue({
      status: 'ok',
      data: 'main',
    })
    item('close-window').action?.()
    await vi.waitFor(() =>
      expect(commands.closeWindowWithFade).toHaveBeenCalledTimes(1)
    )
    expect(helpWindowMock.closeHelpWindow).not.toHaveBeenCalled()
  })
})
