import { beforeEach as beforeHostTest } from 'vitest'
import { readFileSync } from 'node:fs'
import { COLOR_THEME_OPTIONS } from '@/lib/color-theme'
import userEvent from '@testing-library/user-event'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { act, fireEvent, render, screen, waitFor } from '@/test/test-utils'
import { describe, it, expect, beforeEach, vi } from 'vitest'
import { commands } from '@/lib/tauri-bindings'
import { stopAndReset } from '@/lib/open-project'
import { requestPerformanceClose } from '@/lib/performance-selection'
import { useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { SessionActionButton } from './SessionActionButton'
import { Sidebar } from './Sidebar'
import type { Manifest } from '@/lib/tauri-bindings'
import { CreationModeButton } from '@/components/creation/CreationModeButton'
// Existing workflows run after an explicit Host choice and node naming.
beforeHostTest(() => {
  usePerformanceRoleStore.getState().selectRole('host')
  useSettingsStore.setState({ nodeNameSetting: 'Test Host' })
})

const manifest: Manifest = {
  schemaVersion: 1,
  id: 'inarticulate-iii',
  name: 'Inarticulate III',
  version: '0.1.0',
  description: null,
  scoreServer: {
    entry: 'server.js',
    workingDirectory: '.',
    performerPort: 6868,
    monitorPort: 6869,
  },
  audio: {
    defaultMode: 'internal',
    supportedModes: ['internal', 'external', 'none'],
    synthdefs: ['supercollider/synthdefs/inarticulate-iii.scsyndef'],
    scsynth: { sampleRate: 48000, blockSize: 64, audioBusChannels: 128 },
    standaloneTarget: null,
  },
}

const telematicManifest: Manifest = { ...manifest, telematic: true }

/**
 * The three footer states that route a submit differently: plain Load,
 * the #58「设置节点」gate, and the #39/T4 confirm-and-replace switch.
 * The gate verdicts themselves (canStartNow / nodeGateBlocksStart) are
 * covered by session-flow.test.ts — here they are exercised through the
 * button that consumes them.
 */
describe('SessionActionButton', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useProjectStore.setState({
      currentProject: { path: '/p', manifest },
      recentProjectPaths: ['/p'],
      preflightStatus: 'ready',
      preflightError: null,
    })
    useSettingsStore.setState({
      settingsOpen: false,
      focusSection: null,
      nodeNameSetting: 'Test Host',
      hubUrlSetting: '',
      hubTokenSetting: '',
    })
    useSessionStore.getState().resetSession()
    useSessionStore.setState({
      lanIp: '192.168.1.10',
      lanAddresses: ['192.168.1.10'],
      audioMode: 'internal',
      commandPending: false,
    })
    vi.mocked(commands.startProject).mockResolvedValue({
      status: 'ok',
      data: null,
    })
    vi.mocked(commands.stopProject).mockResolvedValue({
      status: 'ok',
      data: null,
    })
  })

  it('renders an enabled Load button when idle and loadable; a click starts', async () => {
    render(<SessionActionButton />)

    const load = screen.getByRole('button', { name: 'Load' })
    expect(load).toBeEnabled()
    expect(load).toHaveClass('desktop-performance-action')
    expect(load).toHaveAttribute('data-desktop-tone', 'primary')
    expect(load).toHaveAttribute('data-performance-action', 'load')
    expect(load).toHaveAttribute('data-busy', 'false')

    fireEvent.click(load)
    await waitFor(() =>
      expect(commands.startProject).toHaveBeenCalledWith(
        '/p',
        'internal',
        '192.168.1.10',
        null
      )
    )
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('keeps the Load label while the mode switch awaits confirmation', async () => {
    vi.mocked(commands.prepareCreationProject).mockResolvedValueOnce({
      status: 'ok',
      data: {
        project: {
          identity: 'selected',
          root: '/p',
          name: 'Inarticulate III',
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
    const load = screen.getByRole('button', { name: 'Load' })
    const mode = screen.getByRole('button', { name: 'Switch to creation mode' })
    expect(load).toBeEnabled()

    fireEvent.click(mode)
    expect(mode).toHaveAttribute('data-phase', 'preparing')
    expect(load).toHaveAccessibleName('Load')
    expect(load).toBeDisabled()
    await waitFor(() => expect(mode).toHaveAttribute('data-phase', 'armed'))
    expect(load).toHaveAccessibleName('Load')
    expect(load).toBeDisabled()
    expect(load).toHaveAttribute('aria-busy', 'false')
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(commands.startProject).not.toHaveBeenCalled()

    fireEvent.keyDown(window, { key: 'Escape' })
    expect(load).toBeEnabled()
  })

  it('restores the Load tone after cold node naming and preflight complete', async () => {
    useProjectStore.setState({ currentProject: null, preflightStatus: 'idle' })
    useSettingsStore.setState({ nodeNameSetting: '' })
    render(<SessionActionButton />)

    expect(screen.getByTestId('setup-node-button')).toHaveAttribute(
      'data-desktop-tone',
      'warning'
    )
    act(() => useSettingsStore.setState({ nodeNameSetting: 'Restored Host' }))
    const load = screen.getByRole('button', { name: 'Load' })
    expect(load).toBeDisabled()
    expect(load).toHaveAttribute('data-desktop-tone', 'neutral')
    expect(load).toHaveAttribute('data-performance-action', 'load')
    expect(screen.queryByTestId('setup-node-button')).not.toBeInTheDocument()

    act(() => {
      useProjectStore.setState({
        currentProject: { path: '/p', manifest },
        preflightStatus: 'checking',
      })
    })
    expect(load).toBeDisabled()
    act(() => useProjectStore.setState({ preflightStatus: 'ready' }))
    await waitFor(() => {
      expect(load).toBeEnabled()
      expect(load).toHaveAttribute('data-desktop-tone', 'primary')
    })
    expect(load).not.toHaveClass('bg-(--pnds-warning)')
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('uses the red Close tone for the running selected project', () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
    })
    render(<SessionActionButton />)

    const close = screen.getByRole('button', { name: 'Close' })
    expect(close).toBeEnabled()
    expect(close).toHaveClass('desktop-performance-action')
    expect(close).toHaveAttribute('data-desktop-tone', 'danger')
    expect(close).toHaveAttribute('data-performance-action', 'close')
    expect(close).toHaveAttribute('data-busy', 'false')
  })

  it('reloads pending configuration through the existing stop/start flow with the Load tone', async () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
      pendingChanges: true,
      audioMode: 'none',
    })
    render(<SessionActionButton />)

    const reload = screen.getByRole('button', { name: 'Reload' })
    expect(reload).toBeEnabled()
    expect(reload).toHaveClass('desktop-performance-action')
    expect(reload).toHaveAttribute('data-desktop-tone', 'primary')
    expect(reload).toHaveAttribute('data-performance-action', 'reload')
    expect(reload).toHaveAttribute('data-busy', 'false')
    fireEvent.click(reload)
    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
      expect(commands.startProject).toHaveBeenCalledWith(
        '/p',
        'none',
        '192.168.1.10',
        null
      )
      expect(useSessionStore.getState().commandPending).toBe(false)
    })
    expect(useProjectStore.getState().currentProject?.path).toBe('/p')
  })

  it('retains the Reload tone and DOM while real busy stages progress after pending changes clear', async () => {
    let finishStop!: () => void
    let finishStart!: () => void
    vi.mocked(commands.stopProject).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishStop = () => resolve({ status: 'ok', data: null })
        })
    )
    vi.mocked(commands.startProject).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishStart = () => resolve({ status: 'ok', data: null })
        })
    )
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
      pendingChanges: true,
    })
    render(<SessionActionButton />)
    const button = screen.getByRole('button', { name: 'Reload' })

    fireEvent.click(button)
    expect(useSessionStore.getState().commandPending).toBe(true)
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBe(button)
    expect(button).toBeDisabled()
    expect(button).toHaveAttribute('data-busy', 'true')
    expect(button).toHaveAttribute('data-desktop-tone', 'primary')

    await waitFor(() => expect(commands.stopProject).toHaveBeenCalledTimes(1))
    expect(useSessionStore.getState().pendingChanges).toBe(false)
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBe(button)
    expect(button).toHaveAttribute('data-performance-action', 'reload')
    expect(button).toHaveAttribute('data-desktop-tone', 'primary')
    fireEvent.click(button)
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(commands.stopProject).toHaveBeenCalledTimes(1)

    act(() => useSessionStore.setState({ sessionStatus: 'stopping' }))
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBe(button)
    await act(async () => finishStop())
    await waitFor(() => expect(commands.startProject).toHaveBeenCalledTimes(1))
    act(() => useSessionStore.setState({ sessionStatus: 'starting' }))
    expect(screen.getByRole('button', { name: 'Starting…' })).toBe(button)
    expect(button).toHaveAttribute('data-performance-action', 'reload')
    expect(button).toHaveAttribute('data-desktop-tone', 'primary')
    await act(async () => finishStart())
    expect(useSessionStore.getState().commandPending).toBe(false)
    expect(button).toBeDisabled()
    expect(screen.getByRole('button', { name: 'Starting…' })).toBe(button)

    act(() => useSessionStore.setState({ sessionStatus: 'ready' }))
    expect(screen.getByRole('button', { name: 'Close' })).toBe(button)
    expect(button).toBeEnabled()
    expect(button).toHaveAttribute('data-busy', 'false')
    expect(button).toHaveAttribute('data-desktop-tone', 'danger')
    expect(button).toHaveAttribute('data-performance-action', 'close')
  })

  it('never promises reopening when an external close stops a project with pending configuration', async () => {
    let finishStop!: () => void
    vi.mocked(commands.stopProject).mockImplementationOnce(
      () =>
        new Promise(resolve => {
          finishStop = () => resolve({ status: 'ok', data: null })
        })
    )
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
      pendingChanges: true,
    })
    render(<SessionActionButton />)
    const button = screen.getByRole('button', { name: 'Reload' })

    let closing!: Promise<boolean>
    act(() => {
      closing = stopAndReset()
    })
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBe(button)
    expect(button).toBeDisabled()
    expect(screen.queryByRole('button', { name: 'Reopening…' })).toBeNull()
    act(() => useSessionStore.setState({ sessionStatus: 'stopping' }))
    expect(screen.getByRole('button', { name: 'Stopping…' })).toBe(button)
    await act(async () => {
      finishStop()
      await closing
    })
    expect(screen.getByRole('button', { name: 'Load' })).toBeDisabled()
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('shows the ⌘W confirmation in the same button over a pending Reload', async () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
      pendingChanges: true,
    })
    render(<SessionActionButton />)
    const button = screen.getByRole('button', { name: 'Reload' })

    act(requestPerformanceClose)

    expect(screen.getByRole('button', { name: 'Press again to close' })).toBe(
      button
    )
    expect(button).toHaveAttribute('aria-keyshortcuts', 'Meta+W')
    expect(button).toHaveAttribute('data-close-armed', 'true')
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(commands.stopProject).not.toHaveBeenCalled()
    fireEvent.keyDown(window, { key: 'Enter' })
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()

    fireEvent.click(button)
    await waitFor(() => expect(commands.stopProject).toHaveBeenCalledOnce())
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it.each([
    'Escape',
    'outside pointer',
    'blur',
    'new run',
    'selection',
    'settings',
  ])('retires the first ⌘W confirmation on %s', reason => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/p',
      runId: 17,
    })
    render(<SessionActionButton />)
    act(requestPerformanceClose)
    expect(
      screen.getByRole('button', { name: 'Press again to close' })
    ).toBeVisible()

    act(() => {
      switch (reason) {
        case 'Escape':
          fireEvent.keyDown(window, { key: 'Escape' })
          break
        case 'outside pointer':
          fireEvent.pointerDown(document.body)
          break
        case 'blur':
          fireEvent.blur(window)
          break
        case 'new run':
          useSessionStore.setState({ runId: 18 })
          break
        case 'selection':
          useProjectStore.setState({ currentProject: { path: '/b', manifest } })
          break
        case 'settings':
          useSettingsStore.setState({ settingsOpen: true })
          break
      }
    })
    expect(
      screen.queryByRole('button', { name: 'Press again to close' })
    ).not.toBeInTheDocument()
    act(requestPerformanceClose)
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it.each([
    ['idle', true, 'Starting…'],
    ['starting', false, 'Starting…'],
    ['stopping', false, 'Stopping…'],
  ] as const)(
    'marks %s commandPending=%s as busy and blocks pointer/Enter submissions',
    (sessionStatus, commandPending, label) => {
      useSessionStore.setState({ sessionStatus, commandPending })
      render(<SessionActionButton />)

      const button = screen.getByRole('button', { name: label })
      expect(button).toBeDisabled()
      expect(button).toHaveAttribute('data-busy', 'true')
      expect(button).toHaveAttribute('data-performance-action', 'load')
      fireEvent.click(button)
      fireEvent.keyDown(window, { key: 'Enter' })
      expect(commands.startProject).not.toHaveBeenCalled()
      expect(commands.stopProject).not.toHaveBeenCalled()
    }
  )

  it.each(COLOR_THEME_OPTIONS)(
    'dims unavailable and loading actions in the $value theme',
    ({ value: theme }) => {
      const style = document.createElement('style')
      style.textContent = readFileSync(
        'src/components/shell/desktop-controls.css',
        'utf8'
      )
      document.head.append(style)
      try {
        useProjectStore.setState({
          currentProject: null,
          preflightStatus: 'idle',
        })
        render(
          <div data-color-theme={theme}>
            <div className="desktop-bar">
              <SessionActionButton />
            </div>
          </div>
        )
        const button = screen.getByRole('button', { name: 'Load' })
        expect(button).toBeDisabled()
        expect(getComputedStyle(button).opacity).not.toBe('')
        expect(Number(getComputedStyle(button).opacity)).toBeLessThan(0.6)
        act(() =>
          useProjectStore.setState({
            currentProject: { path: '/p', manifest },
            preflightStatus: 'ready',
          })
        )
        expect(button).toBeEnabled()
        expect(Number(getComputedStyle(button).opacity)).toBe(1)
        act(() => useSessionStore.setState({ sessionStatus: 'starting' }))
        expect(button).toBeDisabled()
        expect(Number(getComputedStyle(button).opacity)).toBeLessThan(0.6)
      } finally {
        style.remove()
      }
    }
  )

  it('lets folder tabs own Enter without loading the selected project', async () => {
    const user = userEvent.setup()
    useProjectStore.setState({
      activeFolderId: null,
      renameTarget: null,
      projectFolders: [{ id: 'set', name: 'Set list', projectPaths: [] }],
    })
    render(
      <>
        <Sidebar variant="static" />
        <SessionActionButton />
      </>
    )
    const current = useProjectStore.getState().currentProject
    screen.getByRole('tab', { name: 'Home' }).focus()
    await user.keyboard('{Enter}')
    expect(useProjectStore.getState().currentProject).toBe(current)
    await user.keyboard('{ArrowRight}')
    expect(screen.getByRole('tab', { name: 'Home' })).toHaveFocus()
    expect(useProjectStore.getState().activeFolderId).toBeNull()
    screen.getByRole('tab', { name: 'Set list' }).focus()
    await user.keyboard('{Enter}')
    expect(useProjectStore.getState().activeFolderId).toBe('set')
    expect(screen.getByRole('heading', { name: 'Set list' })).toBeVisible()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.preflightProject).not.toHaveBeenCalled()
  })

  it('lets the folder heading own Enter to begin and commit rename without loading a selected project', async () => {
    const user = userEvent.setup()
    useProjectStore.setState({
      activeFolderId: 'set',
      renameTarget: null,
      pendingPreflightPath: null,
      projectFolders: [{ id: 'set', name: 'Set list', projectPaths: ['/p'] }],
    })
    render(
      <>
        <Sidebar variant="static" />
        <SessionActionButton />
      </>
    )
    const load = screen.getByRole('button', { name: 'Load' })
    expect(load).toBeEnabled()
    const current = useProjectStore.getState().currentProject
    const folderName = screen.getByRole('button', { name: 'Set list' })
    folderName.focus()
    await user.keyboard('{Enter}')
    const input = screen.getByTestId('folder-name-input')
    expect(input).toHaveFocus()
    expect(commands.startProject).not.toHaveBeenCalled()
    await user.clear(input)
    await user.type(input, 'Encore{Enter}')
    expect(screen.queryByTestId('folder-name-input')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Encore' })).toHaveFocus()
    expect(screen.getByRole('heading', { name: 'Encore' })).toBeVisible()
    expect(useProjectStore.getState().currentProject).toBe(current)
    expect(useProjectStore.getState().activeFolderId).toBe('set')
    expect(load).toBeEnabled()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.preflightProject).not.toHaveBeenCalled()
  })

  it('#147: a Load gated only by a missing LAN address explains itself instead of sitting gray', async () => {
    // Everything else ready, no usable address at all (the auto-pick has
    // nothing to fill) — the pre-fix bug showed a dead-gray Load.
    useSessionStore.setState({ lanIp: null, lanAddresses: [] })

    render(<SessionActionButton />)

    const load = screen.getByRole('button', { name: 'Load' })
    expect(load).toBeDisabled()
    expect(screen.getByTestId('lan-missing-hint')).toHaveTextContent(
      /No usable network address/i
    )

    // Once an address exists (auto-picked or restored), the hint is gone
    // and the button loads again.
    useSessionStore.setState({ lanIp: '192.168.1.10' })
    await waitFor(() => expect(load).toBeEnabled())
    expect(screen.queryByTestId('lan-missing-hint')).not.toBeInTheDocument()
  })

  it('#58: a gated telematic selection becomes「设置节点」routing to the Node section', () => {
    useProjectStore.setState({
      currentProject: { path: '/p', manifest: telematicManifest },
    })

    render(<SessionActionButton />)

    const setup = screen.getByTestId('setup-node-button')
    expect(setup).toHaveClass('desktop-performance-action')
    expect(setup).toHaveAttribute('data-desktop-tone', 'warning')
    expect(setup).toHaveAttribute('data-performance-action', 'node')
    expect(setup).toHaveAttribute('data-busy', 'false')
    fireEvent.click(setup)

    expect(useSettingsStore.getState().settingsOpen).toBe(true)
    expect(useSettingsStore.getState().focusSection).toBe('node')
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('confirms replacement in the same button, then stops and starts once', async () => {
    // A runs; the selection is B with its own pending config.
    useProjectStore.setState({
      currentProject: { path: '/b', manifest },
      recentProjectPaths: ['/a', '/b'],
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/a',
    })

    render(<SessionActionButton />)

    const button = screen.getByRole('button', { name: 'Load' })
    fireEvent.click(button)
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    expect(button).toHaveTextContent('Click again to switch')
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(button).toHaveAccessibleName(
      'Click again to switch to Inarticulate III'
    )
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    fireEvent.click(button)
    fireEvent.click(button)

    await waitFor(() => {
      expect(commands.stopProject).toHaveBeenCalledTimes(1)
      expect(commands.startProject).toHaveBeenCalledWith(
        '/b',
        'internal',
        '192.168.1.10',
        null
      )
    })
  })

  it.each(['escape', 'outside', 'blur'] as const)(
    'cancels replacement on %s without stopping the current performance',
    action => {
      useSessionStore.setState({
        sessionStatus: 'ready',
        sessionProjectPath: '/a',
      })
      render(<SessionActionButton />)
      const button = screen.getByRole('button', { name: 'Load' })
      fireEvent.click(button)
      expect(button).toHaveTextContent('Click again to switch')
      if (action === 'escape') fireEvent.keyDown(window, { key: 'Escape' })
      else if (action === 'outside') fireEvent.pointerDown(document.body)
      else fireEvent.blur(window)
      expect(button).toHaveAccessibleName('Load')
      expect(button).toHaveAttribute('aria-pressed', 'false')
      expect(commands.stopProject).not.toHaveBeenCalled()
      expect(commands.startProject).not.toHaveBeenCalled()
    }
  )

  it.each([
    'selection',
    'run',
    'lan',
    'preflight',
    'pending-preflight',
    'node',
    'mode',
  ] as const)('requires fresh confirmation after %s changes', change => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/a',
    })
    render(<SessionActionButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument()
    act(() => {
      if (change === 'selection')
        useProjectStore.setState({ currentProject: { path: '/c', manifest } })
      else if (change === 'run')
        useSessionStore.setState(state => ({ runId: state.runId + 1 }))
      else if (change === 'lan')
        useSessionStore.setState({ lanIp: '192.168.1.11' })
      else if (change === 'preflight')
        useProjectStore.setState({ preflightStatus: 'checking' })
      else if (change === 'pending-preflight')
        useProjectStore.setState({ pendingPreflightPath: '/c' })
      else if (change === 'node')
        useSettingsStore.setState({ nodeNameSetting: 'Changed Host' })
      else useSessionStore.setState({ audioMode: 'none' })
    })
    expect(screen.queryByText('Click again to switch')).not.toBeInTheDocument()
    if (change === 'preflight')
      act(() => useProjectStore.setState({ preflightStatus: 'ready' }))
    if (change === 'pending-preflight')
      act(() => useProjectStore.setState({ pendingPreflightPath: null }))
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    expect(screen.getByText('Click again to switch')).toBeVisible()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('uses the same confirmation for Enter and native Load requests', async () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/a',
    })
    render(<SessionActionButton />)
    fireEvent.keyDown(window, { key: 'Enter' })
    const button = screen.getByRole('button', {
      name: 'Click again to switch to Inarticulate III',
    })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(commands.stopProject).not.toHaveBeenCalled()
    act(() => window.dispatchEvent(new Event('pnds:load-selected-project')))
    await waitFor(() => expect(commands.startProject).toHaveBeenCalledTimes(1))
    expect(commands.stopProject).toHaveBeenCalledTimes(1)
  })

  it('retires confirmation when selection changes away and back within one batch', () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/a',
    })
    render(<SessionActionButton />)
    fireEvent.click(screen.getByRole('button', { name: 'Load' }))
    const selected = useProjectStore.getState().currentProject
    act(() => {
      useProjectStore.setState({ currentProject: { path: '/c', manifest } })
      useProjectStore.setState({ currentProject: selected })
      window.dispatchEvent(new Event('pnds:load-selected-project'))
    })
    expect(screen.getByText('Click again to switch')).toBeInTheDocument()
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
  })

  it('prevents held Enter from confirming through the focused button default click', () => {
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: '/a',
    })
    render(<SessionActionButton />)
    const button = screen.getByRole('button', { name: 'Load' })
    button.focus()
    fireEvent.keyDown(button, { key: 'Enter' })
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(fireEvent.keyDown(button, { key: 'Enter', repeat: true })).toBe(
      false
    )
    expect(button).toHaveAttribute('aria-pressed', 'true')
    expect(commands.stopProject).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(fireEvent.keyDown(window, { key: 'Enter', repeat: true })).toBe(true)
  })
})
