import { usePerformanceRoleStore } from '@/store/performance-role-store'
import {
  render,
  screen,
  waitFor,
  cleanup,
  fireEvent,
  within,
} from '@/test/test-utils'
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { useSettingsStore } from '@/store/settings-store'
import { useWebKitBaselineStore } from '@/store/webkit-baseline-store'
import App from './App'

vi.mock('@tauri-apps/plugin-os', () => ({
  hostname: vi.fn().mockResolvedValue('Test Mac'),
  locale: vi.fn().mockResolvedValue('en-US'),
}))
vi.mock('@/lib/menu', () => ({
  buildAppMenu: vi.fn().mockResolvedValue(undefined),
  setupMenuLanguageListener: vi.fn(() => () => undefined),
  setupMenuStateListener: vi.fn(() => () => undefined),
}))

// Tauri bindings are mocked globally in src/test/setup.ts

describe('App', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    usePerformanceRoleStore.setState(usePerformanceRoleStore.getInitialState())
    useSettingsStore.setState({ nodeNameSetting: '', hideBottomBarText: false })
    useWebKitBaselineStore.setState({ belowBaselineVersion: null })
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: null },
    })
    delete document.documentElement.dataset.colorTheme
  })

  afterEach(async () => {
    cleanup()
    // Radix restores dialog focus on a zero-delay timer. Finish that cleanup
    // while this jsdom realm still owns CustomEvent and the removed elements.
    await new Promise(resolve => setTimeout(resolve, 0))
    delete document.documentElement.dataset.colorTheme
  })

  it('requires a saved node name before exposing the default Host', async () => {
    render(<App />)
    expect(usePerformanceRoleStore.getState().role).toBeNull()
    expect(
      screen.queryByRole('button', { name: 'PNDS Client' })
    ).not.toBeInTheDocument()
    const dialog = await screen.findByRole('dialog', {
      name: 'Name this PNDS node',
    })
    expect(usePerformanceRoleStore.getState().role).toBe('host')
    expect(screen.queryByTestId('add-project-button')).not.toBeInTheDocument()
    const name = within(dialog).getByRole('textbox', { name: 'Node name' })
    fireEvent.change(name, { target: { value: 'Stage Mac' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save name' }))
    expect(await screen.findByTestId('add-project-button')).toBeVisible()
    expect(
      screen.getByRole('heading', { name: 'Hi! Welcome to PNDS' })
    ).toBeVisible()
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ nodeName: 'Stage Mac' })
    )
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('requires the same name when the saved role is Client', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: null, lastPerformanceRole: 'client' },
    })
    render(<App />)
    const dialog = await screen.findByRole('dialog', {
      name: 'Name this PNDS node',
    })
    expect(usePerformanceRoleStore.getState().role).toBe('client')
    const name = within(dialog).getByRole('textbox', { name: 'Node name' })
    fireEvent.keyDown(name, { key: 'Escape' })
    expect(dialog).toBeVisible()
    fireEvent.change(name, { target: { value: 'Client Mac' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save name' }))
    await waitFor(() => expect(dialog).not.toBeInTheDocument())
    expect(useSettingsStore.getState().nodeNameSetting).toBe('Client Mac')
    expect(commands.savePreferences).toHaveBeenCalledWith(
      expect.objectContaining({ nodeName: 'Client Mac' })
    )
  })

  it('reuses a valid saved name without reopening the setup dialog', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: null, nodeName: 'Saved Stage' },
    })
    render(<App />)
    expect(await screen.findByTestId('add-project-button')).toBeVisible()
    expect(useSettingsStore.getState().nodeNameSetting).toBe('Saved Stage')
    expect(
      screen.queryByRole('dialog', { name: 'Name this PNDS node' })
    ).not.toBeInTheDocument()
  })

  // v1.2.3 (issue #38): the startup preferences read applies the saved
  // color theme to the root node; an absent value is Pond (the
  // pre-attribute fallback look, now made explicit).
  it('applies the saved color theme to the root node at startup', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', colorTheme: 'sand', language: null },
    })
    render(<App />)

    await waitFor(() => {
      expect(document.documentElement.dataset.colorTheme).toBe('sand')
    })
  })

  it('falls back to Pond when no color theme is saved', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: null },
    })
    render(<App />)

    await waitFor(() => {
      expect(document.documentElement.dataset.colorTheme).toBe('pond')
    })
  })

  it('restores the bottom bar detail preference at startup', async () => {
    vi.mocked(commands.loadPreferences).mockResolvedValue({
      status: 'ok',
      data: { theme: 'system', language: null, hideBottomBarText: true },
    })
    render(<App />)

    await waitFor(() => {
      expect(useSettingsStore.getState().hideBottomBarText).toBe(true)
    })
  })

  // v1.4.2 (#110): the WebKit baseline check runs once at startup; the
  // setup mock's default is a supported Safari, so the gate stays closed.
  it('runs the WebKit baseline check at startup and stays silent when met', async () => {
    render(<App />)

    await waitFor(() => expect(commands.systemSafariVersion).toHaveBeenCalled())
    expect(screen.queryByText('Safari Needs an Update')).not.toBeInTheDocument()
  })

  // #110's other half: below the baseline, the prompt and update
  // guidance are visible right at startup.
  it('surfaces the WebKit baseline dialog at startup when below the baseline', async () => {
    vi.mocked(commands.systemSafariVersion).mockResolvedValue({
      status: 'ok',
      data: '15.1',
    })
    render(<App />)

    await waitFor(() => {
      expect(screen.getByText('Safari Needs an Update')).toBeInTheDocument()
    })
    expect(screen.getByTestId('webkit-baseline-details')).toHaveTextContent(
      'Safari 15.1'
    )
    expect(
      screen.getByRole('button', { name: 'Open Update Guide' })
    ).toBeInTheDocument()
  })

  /**
   * v1.3.0 (#51): the cold-start reveal gate. The window is created
   * hidden and only shown (fadeInWindow) once the saved theme has
   * landed — never before, and even when the preference read fails
   * (an invisible-but-running app helps nobody).
   */
  describe('cold-start reveal gate (#51)', () => {
    it('does not reveal while the preference read is in flight', async () => {
      let resolvePrefs!: (
        value: Awaited<ReturnType<typeof commands.loadPreferences>>
      ) => void
      vi.mocked(commands.loadPreferences).mockImplementation(
        () =>
          new Promise(resolve => {
            resolvePrefs = resolve
          })
      )
      render(<App />)

      // Let the startup chain reach its await on the preferences read.
      await Promise.resolve()
      expect(commands.fadeInWindow).not.toHaveBeenCalled()
      expect(document.documentElement.dataset.colorTheme).toBeUndefined()

      // The read lands → the theme applies → THEN the window reveals.
      resolvePrefs({
        status: 'ok',
        data: { theme: 'system', colorTheme: 'brutal', language: null },
      })
      await waitFor(() => {
        expect(commands.fadeInWindow).toHaveBeenCalledTimes(1)
      })
      // The reveal happened after the themed first paint, not before.
      expect(document.documentElement.dataset.colorTheme).toBe('brutal')
    })

    it('reveals even when the preference read fails', async () => {
      // mockImplementation (not mockRejectedValue): the latter eagerly
      // creates the rejected promise and trips Vitest's unhandled
      // rejection detector outside the await under test.
      vi.mocked(commands.loadPreferences).mockImplementation(() =>
        Promise.reject(new Error('ipc unavailable'))
      )
      render(<App />)

      await waitFor(() => {
        expect(commands.fadeInWindow).toHaveBeenCalled()
      })
    })
  })
})
