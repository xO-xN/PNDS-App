import { describe, it, expect, vi, beforeEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { buildAppMenu } from './menu'

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

const captured = vi.hoisted(() => ({
  menuItems: [] as MenuItemConfig[],
  predefinedItems: [] as PredefinedItemConfig[],
  submenus: [] as SubmenuConfig[],
}))

vi.mock('@tauri-apps/api/menu', () => ({
  Menu: {
    new: vi.fn(async () => ({ setAsAppMenu: vi.fn(async () => undefined) })),
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

/** Custom items by id, asserting presence so callers stay non-null. */
function item(id: string): MenuItemConfig {
  const found = captured.menuItems.find(i => i.id === id)
  if (!found) throw new Error(`menu item "${id}" not built`)
  return found
}

function submenuItems(text: string): unknown[] {
  const submenu = captured.submenus.find(s => s.text === text)
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
  promptOpenProject.mockClear()
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

  it('⌘W opens the close-project confirm while a session runs (v1.2.0)', () => {
    useProjectStore.setState({ confirmCloseProjectOpen: false })
    useSessionStore.setState({ sessionStatus: 'ready' })

    item('close-window').action?.()

    expect(useProjectStore.getState().confirmCloseProjectOpen).toBe(true)
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
    expect(submenuItems('Window')).toEqual([fullscreen])
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
