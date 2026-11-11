import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, fireEvent, render, screen } from '@/test/test-utils'
import { useCreationStore } from '@/store/creation-store'
import { useCreationTestStore } from '@/store/creation-test-store'
import { useSessionStore } from '@/store/session-store'
import { commands } from '@/lib/tauri-bindings'
import { CreationView } from '@/components/creation/CreationView'
import { MonitorView } from './MonitorView'

beforeEach(() => {
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1200)
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(800)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(
    function (this: HTMLElement) {
      return this.classList.contains('monitor-page-viewport') ? 360 : 0
    }
  )
  useCreationStore.setState({
    active: true,
    opening: false,
    modePhase: 'idle',
    workspace: {
      project: {
        identity: 'preview',
        root: '/preview',
        name: 'Preview',
        source: 'folder',
      },
      files: [],
    },
  })
  useCreationTestStore.setState({ expanded: false })
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/preview',
    lanIp: '127.0.0.1',
    monitorZoom: 100,
    commandPending: false,
    health: {
      status: 'ready',
      projectId: 'preview',
      audioMode: 'none',
      audio: { status: 'disabled', target: null, error: null },
      scoreServer: { performerPort: 6868, monitorPort: 6869, error: null },
    },
  })
  vi.clearAllMocks()
})
afterEach(() => vi.restoreAllMocks())
it('renders a desktop viewport in the small preview and uses the actual available area when expanded', () => {
  render(
    <>
      <MonitorView />
      <CreationView />
    </>
  )
  const frame = screen.getByTitle('Project monitor')
  const src = frame.getAttribute('src')
  expect(screen.getByTestId('monitor-scale-frame')).toHaveStyle({
    width: '1200px',
    height: '800px',
    transform: 'scale(0.3)',
  })
  act(() => useSessionStore.setState({ monitorZoom: 200 }))
  expect(screen.getByTestId('monitor-scale-frame')).toHaveStyle({
    width: '600px',
    height: '400px',
    transform: 'scale(0.6)',
  })
  act(() => useSessionStore.setState({ monitorZoom: 100 }))
  const toggle = screen.getByRole('button', { name: 'Expand preview' })
  fireEvent.click(toggle)
  expect(screen.queryByText('http://127.0.0.1:6869')).not.toBeInTheDocument()
  expect(screen.getByTestId('monitor-scale-frame')).toHaveStyle({
    width: '100%',
    height: '100%',
    transform: 'scale(1)',
  })
  expect(screen.getByTitle('Project monitor')).toBe(frame)
  expect(screen.getByRole('button', { name: 'Return to editing' })).toBe(toggle)
  fireEvent.click(toggle)
  vi.spyOn(window, 'innerWidth', 'get').mockReturnValue(1000)
  vi.spyOn(window, 'innerHeight', 'get').mockReturnValue(700)
  act(() => {
    window.dispatchEvent(new Event('resize'))
  })
  expect(screen.getByTestId('monitor-scale-frame')).toHaveStyle({
    width: '1000px',
    height: '700px',
    transform: 'scale(0.36)',
  })
  expect(screen.getByTitle('Project monitor')).toBe(frame)
  expect(frame).toHaveAttribute('src', src)
  expect(commands.stopProject).not.toHaveBeenCalled()
})
