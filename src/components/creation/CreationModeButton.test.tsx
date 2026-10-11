import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { open } from '@tauri-apps/plugin-dialog'
import { useCreationStore } from '@/store/creation-store'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useSettingsStore } from '@/store/settings-store'
import { CreationModeButton } from './CreationModeButton'

describe('prototype mode interaction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useSessionStore.getState().resetSession()
    useProjectStore.getState().clearProject()
    useCreationStore.setState({
      active: false,
      modePhase: 'idle',
      modePlan: null,
      modeError: null,
      hoverPaused: false,
      modePointerInside: false,
      opening: false,
      restoreModeFocus: false,
    })
    useSettingsStore.setState({ colorThemeSetting: 'pond' })
  })
  afterEach(() => vi.useRealTimers())

  it('waits for the 300ms fill and suppresses reverse hover until the pointer leaves', async () => {
    vi.useFakeTimers()
    render(<CreationModeButton />)
    const button = screen.getByRole('button', {
      name: 'Switch to creation mode',
    })
    fireEvent.pointerEnter(button)
    await act(async () => {
      fireEvent.click(button)
    })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    await act(async () => {
      fireEvent.click(button)
    })
    expect(button).toBeDisabled()
    expect(useCreationStore.getState().active).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(299)
    })
    expect(useCreationStore.getState().active).toBe(false)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
    })
    expect(useCreationStore.getState().active).toBe(true)
    expect(button).toHaveAttribute('data-hover-paused', 'true')
    expect(button).not.toBeDisabled()
    fireEvent.pointerLeave(button)
    expect(button).toHaveAttribute('data-hover-paused', 'false')
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('completes directly under Brutal and leaves keyboard focus on the mode control', async () => {
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    render(<CreationModeButton />)
    const button = screen.getByRole('button', {
      name: 'Switch to creation mode',
    })
    await act(async () => {
      fireEvent.click(button, { detail: 0 })
    })
    await act(async () => {
      fireEvent.click(button, { detail: 0 })
    })
    expect(useCreationStore.getState().active).toBe(true)
    expect(button).toHaveFocus()
    expect(button).toHaveAttribute('data-phase', 'idle')
  })

  it('accepts a native folder selection after its blur and an outside click while no mode switch is pending', async () => {
    useCreationStore.setState({ active: true, workspace: null })
    let resolvePicker!: (path: string) => void
    vi.mocked(open).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          resolvePicker = resolve
        })
    )
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: {
        project: {
          identity: 'picked',
          root: '/picked',
          name: 'Picked',
          source: 'folder',
        },
        files: [],
      },
    })
    render(<CreationModeButton />)
    const picking = useCreationStore.getState().pick()
    fireEvent.blur(window)
    fireEvent.pointerDown(document.body)
    await act(async () => {
      resolvePicker('/picked')
      expect(await picking).toBe(true)
    })
    expect(useCreationStore.getState().workspace?.project.root).toBe('/picked')
  })
})
