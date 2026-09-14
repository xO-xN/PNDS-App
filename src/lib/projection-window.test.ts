import { describe, it, expect, vi, beforeEach } from 'vitest'
import { emitTo } from '@tauri-apps/api/event'
import { WebviewWindow } from '@tauri-apps/api/webviewWindow'
import { currentMonitor } from '@tauri-apps/api/window'
import type { Monitor } from '@tauri-apps/api/window'
import i18n from '@/i18n/config'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { commands } from '@/lib/tauri-bindings'
import {
  PROJECTION_WINDOW_LABEL,
  openProjectionWindow,
  closeProjectionWindow,
  setupProjectionWindowBridge,
} from './projection-window'

/**
 * v1.5.0 (#129): the projection window's lifecycle seam — single
 * instance (reuse by focus, never a second stacked venue window), the
 * #51 hidden-create on the App's CURRENT monitor (a failed monitor
 * query must not eat the open), the stuck-hidden re-reveal, and the
 * theme/language live-follow bridge. Mirrors help-window.test (#56).
 */

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

vi.mock('@tauri-apps/api/window', () => ({
  currentMonitor: vi.fn(),
}))

vi.mock('@tauri-apps/api/event', () => ({
  emitTo: vi.fn().mockResolvedValue(undefined),
  listen: vi.fn().mockResolvedValue(() => {
    // Mock unlisten function
  }),
  emit: vi.fn().mockResolvedValue(undefined),
}))

const instanceFor = (overrides: Record<string, unknown> = {}) => ({
  setFocus: vi.fn().mockResolvedValue(undefined),
  close: vi.fn().mockResolvedValue(undefined),
  isVisible: vi.fn().mockResolvedValue(true),
  ...overrides,
})

const MONITOR = {
  name: 'Venue Screen',
  position: { x: 1440, y: 0 },
  size: { width: 1920, height: 1080 },
  workArea: {
    x: 1440,
    y: 0,
    width: 1920,
    height: 1055,
  },
  scaleFactor: 2,
} as unknown as Monitor

describe('projection-window (#129)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(null)
    vi.mocked(currentMonitor).mockResolvedValue(MONITOR)
    useSessionStore.setState({
      sessionStatus: 'idle',
      projectName: null,
    })
  })

  it('creates the window hidden, centered on the App current monitor', async () => {
    await openProjectionWindow()

    expect(WebviewWindow).toHaveBeenCalledTimes(1)
    const [label, options] = vi.mocked(WebviewWindow).mock.calls[0] ?? []
    expect(label).toBe(PROJECTION_WINDOW_LABEL)
    expect(label).toBe('projection')
    expect(options).toMatchObject({
      url: 'projection.html',
      // #51 anti-flash: hidden create; the page reveals itself.
      visible: false,
      resizable: true,
      // Centered in the monitor's 1920×1080 at (1440, 0).
      x: 1440 + (1920 - 1280) / 2,
      y: (1080 - 800) / 2,
    })
    expect('center' in (options ?? {})).toBe(false)
  })

  it('still opens (system-centered) when the monitor query fails', async () => {
    vi.mocked(currentMonitor).mockResolvedValue(null)

    await openProjectionWindow()

    const [, options] = vi.mocked(WebviewWindow).mock.calls[0] ?? []
    expect(options).toMatchObject({ center: true })
    expect(options).not.toHaveProperty('x')
  })

  it('titles the created window with the running project, localized', async () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      projectName: 'Inarticulate III',
    })

    await openProjectionWindow()

    const [, options] = vi.mocked(WebviewWindow).mock.calls[0] ?? []
    expect(options?.title).toBe('PNDS Projection — Inarticulate III')
  })

  it('focuses the live window instead of recreating (single instance)', async () => {
    const existing = instanceFor()
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(
      existing as unknown as WebviewWindow
    )

    await openProjectionWindow()

    expect(existing.setFocus).toHaveBeenCalledTimes(1)
    expect(WebviewWindow).not.toHaveBeenCalled()
  })

  it('re-reveals an existing window left hidden instead of focusing the void', async () => {
    const existing = instanceFor({
      isVisible: vi.fn().mockResolvedValue(false),
    })
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(
      existing as unknown as WebviewWindow
    )

    await openProjectionWindow()

    expect(commands.fadeInWindow).toHaveBeenCalledWith('projection')
    expect(existing.setFocus).not.toHaveBeenCalled()
  })

  it('closes the live window only', async () => {
    const existing = instanceFor()
    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(
      existing as unknown as WebviewWindow
    )
    await closeProjectionWindow()
    expect(existing.close).toHaveBeenCalledTimes(1)

    vi.mocked(WebviewWindow.getByLabel).mockResolvedValue(null)
    await expect(closeProjectionWindow()).resolves.toBeUndefined()
  })

  it('pushes language switches to the open window while bridged', async () => {
    const unsubscribe = setupProjectionWindowBridge()
    try {
      await i18n.changeLanguage('zh-CN')
      await vi.waitFor(() => {
        expect(emitTo).toHaveBeenCalledWith(
          'projection',
          'pnds:projection-locale',
          {
            locale: 'zh-CN',
          }
        )
      })
    } finally {
      unsubscribe()
      await i18n.changeLanguage('en')
    }

    vi.mocked(emitTo).mockClear()
    await i18n.changeLanguage('zh-CN')
    expect(emitTo).not.toHaveBeenCalledWith(
      'projection',
      'pnds:projection-locale',
      expect.anything()
    )
    await i18n.changeLanguage('en')
  })

  it('pushes theme changes to the open window, only when the value moves', async () => {
    const unsubscribe = setupProjectionWindowBridge()
    try {
      vi.mocked(emitTo).mockClear()
      useSettingsStore.setState({ colorThemeSetting: 'stage' })
      await vi.waitFor(() =>
        expect(emitTo).toHaveBeenCalledWith(
          'projection',
          'pnds:projection-theme',
          {
            colorTheme: 'stage',
          }
        )
      )

      // Unrelated store churn must not spam the window.
      vi.mocked(emitTo).mockClear()
      useSettingsStore.setState({ settingsOpen: true })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(emitTo).not.toHaveBeenCalledWith(
        'projection',
        'pnds:projection-theme',
        expect.anything()
      )
    } finally {
      unsubscribe()
      useSettingsStore.setState({
        colorThemeSetting: 'pond',
        settingsOpen: false,
      })
    }
  })
})
