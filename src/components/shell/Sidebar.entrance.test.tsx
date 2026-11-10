import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { act, cleanup } from '@testing-library/react'
import { render, screen, fireEvent, waitFor } from '@/test/test-utils'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { useSettingsStore } from '@/store/settings-store'
import { useSessionStore } from '@/store/session-store'
import { useProjectStore } from '@/store/project-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { useCreationStore } from '@/store/creation-store'
import { useWindowStore } from '@/store/window-store'
import { HoverSidebar } from './HoverSidebar'

const animateDescriptor = Object.getOwnPropertyDescriptor(
  Element.prototype,
  'animate'
)
let animatedRows: Element[]
let animationCancels: ReturnType<typeof vi.fn>[]
let offscreenSelection: boolean

beforeEach(() => {
  animatedRows = []
  animationCancels = []
  offscreenSelection = false
  usePerformanceRoleStore.getState().resetRole()
  usePerformanceRoleStore.getState().selectRole('host')
  useSettingsStore.setState({
    nodeNameSetting: 'Test Host',
    colorThemeSetting: 'pond',
    settingsOpen: false,
  })
  useSessionStore.getState().resetSession()
  useSessionStore.setState({
    sessionStatus: 'ready',
    sessionProjectPath: '/a',
  })
  useProjectStore.setState({
    currentProject: null,
    pendingPreflightPath: '/a',
    failedPreflightPath: null,
    recentProjectPaths: ['/a', '/b'],
    utilityPaths: [],
    projectFolders: [],
    activeFolderId: null,
    renameTarget: null,
    confirmCloseProjectOpen: false,
  })
  useKeyboardStore.setState({
    commandKeyPressed: false,
    projectSelectionRevealed: false,
  })
  useCreationStore.setState({ active: false, modePhase: 'idle' })
  useWindowStore.setState({
    fullscreen: false,
    confirmCloseOpen: false,
    quitConfirmOpen: false,
  })
  const originalRect = HTMLElement.prototype.getBoundingClientRect
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
    function (this: HTMLElement) {
      if (
        this.hasAttribute('data-project-scroll') ||
        this.hasAttribute('data-project-path')
      ) {
        const scroller = this.hasAttribute('data-project-scroll')
        const path = this.dataset.projectPath
        let top = path === '/b' ? 161 : 100
        if (offscreenSelection) {
          if (scroller)
            Object.defineProperty(this, 'scrollHeight', {
              configurable: true,
              value: 1000,
            })
          else {
            const container = this.closest<HTMLElement>('[data-project-scroll]')
            top =
              (path === '/b' ? 700 : path === '/d' ? 900 : 100) -
              (container?.scrollTop ?? 0)
          }
        }
        const height = scroller ? 488 : 57
        return new DOMRect(20, top, 260, height)
      }
      return originalRect.call(this)
    }
  )
  Object.defineProperty(Element.prototype, 'animate', {
    configurable: true,
    value: function (this: Element) {
      if (this.hasAttribute('data-project-path')) animatedRows.push(this)
      const cancel = vi.fn()
      animationCancels.push(cancel)
      return { cancel } as unknown as Animation
    },
  })
})

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
  if (animateDescriptor)
    Object.defineProperty(Element.prototype, 'animate', animateDescriptor)
  else Reflect.deleteProperty(Element.prototype, 'animate')
})

it('plays the real overlay list on its first visible reveal, then keeps hover reopen immediate', async () => {
  render(<HoverSidebar />)
  const panel = screen.getByTestId('sidebar-popover')
  expect(panel).toHaveAttribute('inert')
  expect(animatedRows).toHaveLength(0)

  fireEvent.mouseEnter(screen.getByTestId('sidebar-hover-zone'))
  await waitFor(() => expect(animatedRows).toHaveLength(2))
  expect(panel).not.toHaveAttribute('inert')
  expect(
    animatedRows.map(element => element.getAttribute('data-project-path'))
  ).toEqual(['/a', '/b'])

  fireEvent.mouseLeave(panel)
  expect(panel).toHaveAttribute('inert')
  fireEvent.mouseEnter(screen.getByTestId('sidebar-hover-zone'))
  expect(panel).not.toHaveAttribute('inert')
  expect(animatedRows).toHaveLength(2)
})

it('positions the initial and switched-folder selection before entrance, retaining smooth in-folder navigation', async () => {
  offscreenSelection = true
  useProjectStore.setState({
    recentProjectPaths: ['/a', '/b', '/c', '/d'],
    projectFolders: [
      { id: 'first', name: 'First', projectPaths: ['/a', '/b'] },
      { id: 'second', name: 'Second', projectPaths: ['/c', '/d'] },
    ],
    activeFolderId: 'first',
    pendingPreflightPath: '/b',
  })
  useSessionStore.setState({ sessionProjectPath: '/b' })
  const scrollTo = vi
    .spyOn(Element.prototype, 'scrollTo')
    .mockImplementation(function (
      this: Element,
      options?: ScrollToOptions | number
    ) {
      if (typeof options === 'object') this.scrollTop = options.top ?? 0
    })
  render(<HoverSidebar />)
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 195, behavior: 'instant' })
  fireEvent.mouseEnter(screen.getByTestId('sidebar-hover-zone'))
  await waitFor(() => expect(animatedRows).toHaveLength(1))
  expect(animatedRows[0]).toHaveAttribute('data-project-path', '/b')
  fireEvent.scroll(screen.getByTestId('project-list-scroll'))
  expect(animationCancels.every(cancel => cancel.mock.calls.length === 0)).toBe(
    true
  )
  const firstWaveCount = animationCancels.length

  act(() => {
    useProjectStore.setState({
      activeFolderId: 'second',
      pendingPreflightPath: '/d',
    })
  })
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 395, behavior: 'instant' })
  await waitFor(() => expect(animatedRows).toHaveLength(2))
  expect(animatedRows[1]).toHaveAttribute('data-project-path', '/d')
  const folderWave = animationCancels.slice(firstWaveCount)
  fireEvent.scroll(screen.getByTestId('project-list-scroll'))
  expect(folderWave.every(cancel => cancel.mock.calls.length === 0)).toBe(true)

  act(() => {
    useProjectStore.setState({ pendingPreflightPath: '/c' })
  })
  expect(scrollTo).toHaveBeenLastCalledWith({ top: 0, behavior: 'smooth' })
  expect(animatedRows).toHaveLength(2)
})
