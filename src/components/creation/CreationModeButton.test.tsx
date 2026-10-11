import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { open } from '@tauri-apps/plugin-dialog'
import userEvent from '@testing-library/user-event'
import { SessionActionButton } from '@/components/shell/SessionActionButton'
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

  it.each(['brutal', 'reducedMotion'] as const)(
    'completes directly under %s and leaves keyboard focus on the mode control',
    async preference => {
      vi.useFakeTimers()
      if (preference === 'brutal')
        useSettingsStore.setState({ colorThemeSetting: 'brutal' })
      else
        vi.mocked(window.matchMedia).mockReturnValueOnce({
          ...window.matchMedia('(prefers-reduced-motion: reduce)'),
          matches: true,
        })
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
    }
  )

  it.each(['escape', 'outside', 'blur'] as const)(
    'cancels confirmation on %s without stopping or closing windows',
    async action => {
      render(<CreationModeButton />)
      const button = screen.getByRole('button', {
        name: 'Switch to creation mode',
      })
      await act(async () => {
        fireEvent.click(button)
      })
      expect(button).toHaveAttribute('aria-pressed', 'true')
      if (action === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
      else if (action === 'outside') fireEvent.pointerDown(document.body)
      else fireEvent.blur(window)
      expect(button).toHaveAttribute('aria-pressed', 'false')
      expect(useCreationStore.getState().active).toBe(false)
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.closeCreationProjection).not.toHaveBeenCalled()
      expect(commands.commitCreationProject).not.toHaveBeenCalled()
    }
  )

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

  it('uses Enter for mode confirmation rather than loading the selected project', async () => {
    useProjectStore.setState({
      preflightStatus: 'ready',
      currentProject: {
        path: '/selected',
        manifest: {
          schemaVersion: 1,
          id: 'selected',
          name: 'Selected',
          version: '1',
          description: null,
          scoreServer: {
            entry: 'server.js',
            workingDirectory: '.',
            performerPort: 6868,
            monitorPort: 6869,
          },
          audio: {
            defaultMode: 'none',
            supportedModes: ['none'],
            synthdefs: null,
            scsynth: null,
            standaloneTarget: null,
          },
        },
      },
    })
    useSessionStore.setState({ lanIp: '192.168.1.20', audioMode: 'none' })
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: {
        project: {
          identity: 'selected',
          root: '/selected',
          name: 'Selected',
          source: 'folder',
        },
        files: [],
      },
    })
    render(
      <>
        <SessionActionButton />
        <CreationModeButton />
      </>
    )
    const button = screen.getByRole('button', {
      name: 'Switch to creation mode',
    })
    button.focus()
    const user = userEvent.setup()
    await user.keyboard('[Enter]')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(commands.startProject).not.toHaveBeenCalled()
    await user.keyboard('[Enter]')
    expect(useCreationStore.getState().active).toBe(true)
    expect(useCreationStore.getState().workspace?.project.root).toBe(
      '/selected'
    )
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('exposes the second confirmation and its actual consequence to assistive technology', async () => {
    render(<CreationModeButton />)
    const button = screen.getByRole('button', {
      name: 'Switch to creation mode',
    })
    await act(async () => {
      fireEvent.click(button)
    })
    expect(button).toHaveAccessibleName(
      'Click again to switch to Creation mode'
    )
    expect(button).toHaveAccessibleDescription(/creation home/i)
  })

  it('returns keyboard focus to the mode control after a failed projection close', async () => {
    useSettingsStore.setState({ colorThemeSetting: 'brutal' })
    render(
      <>
        <CreationModeButton />
        <button type="button">Other control</button>
      </>
    )
    const button = screen.getByRole('button', {
      name: 'Switch to creation mode',
    })
    let failClose!: () => void
    vi.mocked(commands.closeCreationProjection).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          failClose = () =>
            resolve({
              status: 'error',
              error: { code: 'io', detail: 'Projection could not close' },
            })
        })
    )
    button.focus()
    const user = userEvent.setup()
    await user.keyboard('[Enter]')
    await user.keyboard('[Enter]')
    screen.getByRole('button', { name: 'Other control' }).focus()
    await act(async () => {
      failClose()
    })
    expect(useCreationStore.getState().active).toBe(false)
    expect(useCreationStore.getState().modePhase).toBe('idle')
    expect(button).toHaveFocus()
    expect(commands.commitCreationProject).not.toHaveBeenCalled()
  })
})
