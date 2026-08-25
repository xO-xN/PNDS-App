import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emitTo } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import i18n from '@/i18n/config'
import { useSettingsStore } from '@/store/settings-store'
import { commands } from '@/lib/tauri-bindings'
import {
  HELP_WINDOW_LABEL,
  openHelpWindow,
  closeHelpWindow,
  pushHelpLocale,
  setupHelpWindowBridge,
} from './help-window'

/**
 * v1.3.0 (#56): the help center's window lifecycle seam — everything the
 * Help menu and the ⌘W dispatch need, away from React. Opening either
 * creates the window HIDDEN (the #51 anti-flash pattern: the page
 * reveals itself via fade-in once its theme and content are ready) with
 * the target in the URL, or reuses the live window by focusing it and
 * sending the target over an event. A window left hidden (an early page
 * error) is re-revealed rather than focused into invisibility.
 */

const instanceFor = (overrides: Record<string, unknown> = {}) => ({
  setFocus: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  isVisible: vi.fn().mockResolvedValue(true),
  ...overrides,
})

vi.mock('@tauri-apps/api/webviewWindow', () => ({
  WebviewWindow: Object.assign(
    // A regular function so `new WebviewWindow(...)` works in the module.
    vi.fn().mockImplementation(function (
      this: { label: string; options: unknown; once: unknown },
      label: string,
      options: unknown
    ) {
      this.label = label
      this.options = options
      this.once = vi.fn()
    }),
    { getByLabel: vi.fn() }
  ),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn(async (name: string, handler: (event: unknown) => void) => {
    listeners.set(name, payload => handler({ payload }))
    return () => {
      listeners.delete(name)
    }
  }),
  emit: vi.fn().mockResolvedValue(undefined),
}))

const listeners = vi.hoisted(
  () => new Map<string, (payload: unknown) => void>()
)

describe('help-window (#56)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(null)
  })

  it('creates the help window hidden with the doc target in the URL', async () => {
    await openHelpWindow({ kind: 'doc', docId: 'app-tutorial' })

    expect(WebviewWindow).toHaveBeenCalledTimes(1)
    const [label, options] = vi.mocked(WebviewWindow).mock.calls[0] ?? []
    expect(label).toBe(HELP_WINDOW_LABEL)
    expect(label).toBe('help')
    expect(options).toMatchObject({
      url: 'help.html?doc=app-tutorial',
      // #51 anti-flash: hidden create; the page reveals itself.
      visible: false,
      resizable: true,
    })
    expect(options?.title).toBe('PNDS Help')
  })

  it('focuses the live window and sends the target instead of recreating', async () => {
    const existing = instanceFor()
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(
      existing as unknown as WebviewWindow
    )

    await openHelpWindow({ kind: 'doc', docId: 'reference-manifest' })

    expect(existing.setFocus).toHaveBeenCalledTimes(1)
    expect(emitTo).toHaveBeenCalledWith('help', 'pnds:help-navigate', {
      kind: 'doc',
      docId: 'reference-manifest',
    })
    expect(WebviewWindow).not.toHaveBeenCalled()
  })

  it('re-reveals an existing window left hidden instead of focusing the void', async () => {
    const existing = instanceFor({
      isVisible: vi.fn().mockResolvedValue(false),
    })
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(
      existing as unknown as WebviewWindow
    )

    await openHelpWindow({ kind: 'search' })

    expect(commands.fadeInWindow).toHaveBeenCalledWith('help')
  })

  it('closes the live window only', async () => {
    const existing = instanceFor()
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(
      existing as unknown as WebviewWindow
    )
    await closeHelpWindow()
    expect(existing.close).toHaveBeenCalledTimes(1)

    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(null)
    await expect(closeHelpWindow()).resolves.toBeUndefined()
  })

  it('pushes the resolved locale to the window, never throwing', async () => {
    await pushHelpLocale('zh-CN')
    expect(emitTo).toHaveBeenCalledWith('help', 'pnds:help-locale', {
      locale: 'zh-CN',
    })

    vi.mocked(emitTo).mockRejectedValueOnce(new Error('window gone'))
    await expect(pushHelpLocale('en')).resolves.toBeUndefined()
  })

  it('follows app language switches while the bridge is set up', async () => {
    const unsubscribe = setupHelpWindowBridge()
    try {
      await i18n.changeLanguage('zh-CN')
      await vi.waitFor(() => {
        expect(emitTo).toHaveBeenCalledWith('help', 'pnds:help-locale', {
          locale: 'zh-CN',
        })
      })
    } finally {
      unsubscribe()
      await i18n.changeLanguage('en')
    }

    vi.mocked(emitTo).mockClear()
    await i18n.changeLanguage('zh-CN')
    expect(emitTo).not.toHaveBeenCalledWith(
      'help',
      'pnds:help-locale',
      expect.anything()
    )
    await i18n.changeLanguage('en')
  })

  it('pushes theme changes to the open window, only when the value moves', async () => {
    const unsubscribe = setupHelpWindowBridge()
    try {
      vi.mocked(emitTo).mockClear()
      useSettingsStore.setState({ colorThemeSetting: 'stage' })
      await vi.waitFor(() =>
        expect(emitTo).toHaveBeenCalledWith('help', 'pnds:help-theme', {
          colorTheme: 'stage',
        })
      )

      // Unrelated store churn must not spam the window.
      vi.mocked(emitTo).mockClear()
      useSettingsStore.setState({ settingsOpen: true })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(emitTo).not.toHaveBeenCalledWith(
        'help',
        'pnds:help-theme',
        expect.anything()
      )
    } finally {
      unsubscribe()
      useSettingsStore.setState({
        colorThemeSetting: 'lavender',
        settingsOpen: false,
      })
    }
  })

  it('replays the last target when the page announces readiness', async () => {
    const unsubscribe = setupHelpWindowBridge()
    try {
      const existing = instanceFor()
      vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(
        existing as unknown as WebviewWindow
      )
      await openHelpWindow({ kind: 'doc', docId: 'reference-manifest' })
      vi.mocked(emitTo).mockClear()

      // The page finished booting — the target lost while it had no
      // listener is delivered now.
      listeners.get('pnds:help-ready')?.(undefined)
      expect(emitTo).toHaveBeenCalledWith('help', 'pnds:help-navigate', {
        kind: 'doc',
        docId: 'reference-manifest',
      })
    } finally {
      unsubscribe()
    }
  })
})
