import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isTauri } from '@tauri-apps/api/core'
import type * as TauriCore from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import {
  act,
  fireEvent,
  mockBoundingClientRect,
  render,
  screen,
} from '@/test/test-utils'
import { commands } from '@/lib/tauri-bindings'
import { useCreationStore } from '@/store/creation-store'
import { useKeyboardStore } from '@/store/keyboard-store'
import { usePerformanceRoleStore } from '@/store/performance-role-store'
import { UTILITIES_FOLDER_ID, useProjectStore } from '@/store/project-store'
import { useSessionStore } from '@/store/session-store'
import { useSettingsStore } from '@/store/settings-store'
import { HoverSidebar } from './HoverSidebar'
import { Sidebar } from './Sidebar'

vi.mock('@tauri-apps/api/core', async importOriginal => ({
  ...(await importOriginal<typeof TauriCore>()),
  isTauri: vi.fn(() => false),
}))

const FIRST = '/scores/first'
const SECOND = '/scores/second'
const THIRD = '/scores/third'
const TOOL = '/utilities/tool'

function swipe(target: Element, init: WheelEventInit) {
  const event = new WheelEvent('wheel', {
    bubbles: true,
    cancelable: true,
    ...init,
  })
  Object.defineProperty(event, 'timeStamp', { value: performance.now() })
  fireEvent(target, event)
  return event.defaultPrevented
}

async function elapse(ms = 250) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms)
  })
}

function card(path: string) {
  return screen.getByTitle(path)
}

function expectFolder(name: string) {
  expect(screen.getByRole('tab', { name })).toHaveAttribute(
    'aria-selected',
    'true'
  )
}

function mockSlide(content: HTMLElement) {
  let finishExit: (() => void) | undefined
  const exitFinished = new Promise<void>(resolve => {
    finishExit = resolve
  })
  const cancelExit = vi.fn(() => finishExit?.())
  const animate = vi
    .fn()
    .mockReturnValueOnce({ finished: exitFinished, cancel: cancelExit })
    .mockReturnValue({ finished: Promise.resolve(), cancel: vi.fn() })
  Object.defineProperty(content, 'animate', { value: animate })
  return { animate, cancelExit, finishExit: () => finishExit?.() }
}

function listDisplacement(content: HTMLElement) {
  const translation = content.style.translate || content.style.transform
  return Number.parseFloat(translation.match(/-?[\d.]+(?=px)/)?.[0] ?? '0')
}

function renderSidebar(variant: 'overlay' | 'static' = 'static') {
  render(<Sidebar variant={variant} />)
  return measureSidebar()
}

function measureSidebar() {
  const list = screen.getByTestId('project-list-scroll')
  mockBoundingClientRect(list, {
    top: 80,
    height: 360,
    width: 320,
  })
  return list
}

function nativeTrackpad() {
  const callback = vi
    .mocked(listen)
    .mock.calls.find(([name]) => name === 'sidebar-trackpad-event')?.[1]
  expect(callback).toBeDefined()
  return (phase: 'began' | 'changed' | 'ended' | 'cancelled', deltaX = 0) => {
    act(() =>
      callback?.({
        event: 'sidebar-trackpad-event',
        id: 1,
        payload: { phase, deltaX, deltaY: 0, x: 100, y: 100 },
      })
    )
  }
}

describe('Sidebar project folder swipes', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.mocked(isTauri).mockReturnValue(false)
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout', 'performance'] })
    useCreationStore.setState({ active: false, modePhase: 'idle' })
    useSessionStore.getState().resetSession()
    useProjectStore.setState({
      activeFolderId: null,
      currentProject: null,
      pendingPreflightPath: null,
      failedPreflightPath: null,
      renameTarget: null,
      recentProjectPaths: [FIRST, SECOND, THIRD, TOOL],
      utilityPaths: [TOOL],
      projectFolders: [
        { id: 'opening', name: 'Opening', projectPaths: [THIRD] },
        { id: 'finale', name: 'Finale', projectPaths: [] },
        { id: UTILITIES_FOLDER_ID, name: 'Utilities', projectPaths: [TOOL] },
      ],
    })
  })

  afterEach(() => vi.useRealTimers())

  it('switches folders once per swipe and keeps project membership and history intact', async () => {
    const { projectFolders, recentProjectPaths } = useProjectStore.getState()
    renderSidebar('overlay')

    expect(swipe(card(FIRST), { deltaX: 30 })).toBe(true)
    expectFolder('Home')
    await elapse(16)
    expect(swipe(card(FIRST), { deltaX: 80 })).toBe(true)
    expectFolder('Home')
    await elapse()
    expectFolder('Opening')
    expect(screen.queryByTitle(FIRST)).toBeNull()
    expect(card(THIRD)).toBeVisible()

    expect(swipe(card(THIRD), { deltaX: -110 })).toBe(true)
    await elapse()
    expectFolder('Home')
    expect(card(FIRST)).toBeVisible()
    expect(card(SECOND)).toBeVisible()
    expect(useProjectStore.getState()).toMatchObject({
      projectFolders,
      recentProjectPaths,
    })
    expect(commands.savePreferences).not.toHaveBeenCalled()
    expect(commands.startProject).not.toHaveBeenCalled()
    expect(commands.stopProject).not.toHaveBeenCalled()
  })

  it('cycles between user folders, Home and Utilities, including empty lists', async () => {
    const list = renderSidebar()

    swipe(list, { deltaX: 110 })
    await elapse()
    expectFolder('Opening')
    swipe(list, { deltaX: 110 })
    expect(screen.getByTestId('folder-swipe-preview')).toHaveTextContent(
      'This folder is empty'
    )
    await elapse()
    expectFolder('Finale')
    const empty = screen.getByTestId('folder-empty')
    swipe(empty, { deltaX: 110 })
    await elapse()
    expectFolder('Utilities')
    expect(card(TOOL)).toBeVisible()
    swipe(card(TOOL), { deltaX: 110 })
    await elapse()
    expectFolder('Home')
    swipe(list, { deltaX: -110 })
    await elapse()
    expectFolder('Utilities')
  })

  it('keeps the visible overlay swipable after switching clears its pending selection', async () => {
    usePerformanceRoleStore.setState({ role: 'host' })
    useSettingsStore.setState({ nodeNameSetting: 'Test Host' })
    useKeyboardStore.setState({
      commandKeyPressed: false,
      projectSelectionRevealed: false,
    })
    useSessionStore.setState({
      sessionStatus: 'ready',
      sessionProjectPath: THIRD,
    })
    useProjectStore.setState({
      pendingPreflightPath: FIRST,
      failedPreflightPath: THIRD,
    })
    render(<HoverSidebar />)
    const list = measureSidebar()
    const panel = screen.getByTestId('sidebar-popover')
    expect(panel).not.toHaveAttribute('inert')

    swipe(list, { deltaX: 110 })
    await elapse()
    expectFolder('Opening')
    expect(useProjectStore.getState().pendingPreflightPath).toBeNull()
    expect(panel).not.toHaveAttribute('inert')

    expect(swipe(list, { deltaX: 110 })).toBe(true)
    await elapse()
    expectFolder('Finale')
  })

  it('uses native finger lift to switch folders and re-arms on the next gesture', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    renderSidebar()
    const content = screen.getByTestId('project-list-content')
    const gesture = nativeTrackpad()

    gesture('began')
    gesture('changed', -35)
    const nativeDisplacement = listDisplacement(content)
    expect(nativeDisplacement).toBeLessThan(0)
    expect(swipe(card(FIRST), { deltaX: 35 })).toBe(false)
    expect(listDisplacement(content)).toBe(nativeDisplacement)
    gesture('changed', -70)
    await elapse()
    expectFolder('Home')
    gesture('ended')
    expectFolder('Opening')

    expect(swipe(card(THIRD), { deltaX: 110 })).toBe(false)
    await elapse()
    expectFolder('Opening')

    gesture('began')
    gesture('changed', -110)
    gesture('cancelled')
    expectFolder('Opening')
    expect(listDisplacement(content)).toBe(0)

    gesture('began')
    gesture('changed', -110)
    gesture('ended')
    expectFolder('Finale')
  })

  it('tracks another native swipe while the first folder is still sliding out', async () => {
    vi.mocked(isTauri).mockReturnValue(true)
    renderSidebar()
    const content = screen.getByTestId('project-list-content')
    const { animate, cancelExit } = mockSlide(content)
    const gesture = nativeTrackpad()

    gesture('began')
    gesture('changed', -110)
    gesture('ended')
    expectFolder('Home')
    expect(animate).toHaveBeenCalledOnce()

    gesture('began')
    expect(cancelExit).toHaveBeenCalledOnce()
    expectFolder('Opening')
    gesture('changed', -110)
    expect(listDisplacement(content)).toBeLessThan(0)
    gesture('ended')
    await elapse()
    expectFolder('Finale')
  })

  it.each([
    { direction: 1, nextFolder: 'Opening', nextPath: THIRD, name: 'Third' },
    { direction: -1, nextFolder: 'Utilities', nextPath: TOOL, name: 'Tool' },
  ])(
    'tracks and settles both lists together when swiping into $nextFolder',
    async ({ direction, nextFolder, nextPath, name }) => {
      const { projectFolders, recentProjectPaths } = useProjectStore.getState()
      renderSidebar()
      const content = screen.getByTestId('project-list-content')
      const { animate, finishExit } = mockSlide(content)

      swipe(card(FIRST), { deltaX: direction * 25 })
      const preview = screen.getByTestId('folder-swipe-preview')
      expect(content).toContainElement(preview)
      expect(preview).toHaveTextContent(name)
      expect(preview).toHaveAttribute('aria-hidden', 'true')
      expect(preview).toHaveAttribute('inert')
      expect(listDisplacement(preview)).toBe(direction * 320)
      expect(screen.queryByTitle(nextPath)).not.toBeInTheDocument()
      const firstDisplacement = listDisplacement(content)
      expect(firstDisplacement * direction).toBeLessThan(0)
      expect(content).toContainElement(card(SECOND))
      await elapse(16)
      swipe(card(SECOND), { deltaX: direction * 85 })
      const finalDisplacement = listDisplacement(content)
      expect(finalDisplacement * direction).toBeLessThan(
        firstDisplacement * direction
      )
      expectFolder('Home')
      expect(animate).not.toHaveBeenCalled()

      await elapse()
      expectFolder('Home')
      expect(animate).toHaveBeenCalledOnce()
      expect(content).toContainElement(preview)

      await act(async () => finishExit())

      expectFolder(nextFolder)
      expect(content).toContainElement(card(nextPath))
      expect(preview).not.toBeInTheDocument()
      expect(animate).toHaveBeenCalledOnce()
      expect(useProjectStore.getState()).toMatchObject({
        projectFolders,
        recentProjectPaths,
      })
      expect(commands.savePreferences).not.toHaveBeenCalled()
    }
  )

  it('switches the live preview to the opposite neighbor when crossing back over the origin', () => {
    renderSidebar()
    const content = screen.getByTestId('project-list-content')

    swipe(card(FIRST), { deltaX: 60 })
    expect(screen.getByTestId('folder-swipe-preview')).toHaveTextContent(
      'Third'
    )
    expect(listDisplacement(content)).toBeLessThan(0)

    swipe(card(FIRST), { deltaX: -120 })

    const preview = screen.getByTestId('folder-swipe-preview')
    expect(preview).toHaveTextContent('Tool')
    expect(preview).not.toHaveTextContent('Third')
    expect(listDisplacement(preview)).toBe(-320)
    expect(listDisplacement(content)).toBeGreaterThan(0)
    expectFolder('Home')
  })

  it('aligns the adjacent list preview with the top of a scrolled source viewport', () => {
    const list = renderSidebar()
    list.scrollTop = 180

    swipe(card(FIRST), { deltaX: 50 })

    expect(screen.getByTestId('folder-swipe-preview')).toHaveStyle({
      top: '180px',
    })
    expect(list.scrollTop).toBe(180)
  })

  it('returns to its original position when reversing brings the swipe below threshold', async () => {
    renderSidebar()
    const content = screen.getByTestId('project-list-content')
    const { animate, finishExit } = mockSlide(content)

    swipe(card(FIRST), { deltaX: 110 })
    const farDisplacement = listDisplacement(content)
    expect(farDisplacement).toBeLessThan(0)
    const preview = screen.getByTestId('folder-swipe-preview')
    await elapse(16)
    swipe(card(FIRST), { deltaX: -84 })
    expect(listDisplacement(content)).toBeGreaterThan(farDisplacement)
    expect(listDisplacement(content)).toBeLessThan(0)
    expect(animate).not.toHaveBeenCalled()
    await elapse()
    expect(animate).toHaveBeenCalledOnce()
    expect(content).toContainElement(preview)
    await act(async () => finishExit())

    expectFolder('Home')
    expect(content).toContainElement(card(FIRST))
    expect(listDisplacement(content)).toBe(0)
    expect(preview).not.toBeInTheDocument()
    expect(commands.savePreferences).not.toHaveBeenCalled()
  })

  it('keeps a tab choice made during the exit animation', async () => {
    renderSidebar()
    const { animate, cancelExit } = mockSlide(
      screen.getByTestId('project-list-content')
    )

    swipe(card(FIRST), { deltaX: 110 })
    await elapse()
    expect(animate).toHaveBeenCalledOnce()
    await act(async () => {
      fireEvent.click(screen.getByRole('tab', { name: 'Finale' }))
    })

    expect(cancelExit).toHaveBeenCalled()
    expectFolder('Finale')
    expect(animate).toHaveBeenCalledOnce()
  })

  it('switches on release without movement when reduced motion is enabled', async () => {
    const media = {
      ...window.matchMedia('(prefers-reduced-motion: reduce)'),
      matches: true,
    }
    const animate = vi.fn()
    vi.mocked(window.matchMedia).withImplementation(
      () => media,
      () => {
        renderSidebar()
        Object.defineProperty(
          screen.getByTestId('project-list-content'),
          'animate',
          { value: animate }
        )
        swipe(card(FIRST), { deltaX: 110 })
        expectFolder('Home')
        expect(screen.queryByTestId('folder-swipe-preview')).toBeNull()
        expect(
          listDisplacement(screen.getByTestId('project-list-content'))
        ).toBe(0)
      }
    )

    await elapse()
    expectFolder('Opening')
    expect(animate).not.toHaveBeenCalled()
  })

  it('leaves vertical scrolling, zooming and events outside the list alone', async () => {
    renderSidebar()

    expect(swipe(card(FIRST), { deltaX: 30, deltaY: 80 })).toBe(false)
    await elapse(16)
    expect(swipe(card(FIRST), { deltaX: 110, deltaY: 40 })).toBe(false)
    await elapse()
    expect(swipe(card(FIRST), { deltaX: 110, ctrlKey: true })).toBe(false)
    expect(swipe(card(FIRST), { deltaX: 110, buttons: 1 })).toBe(false)
    expect(swipe(card(FIRST), { deltaX: 110, deltaMode: 1 })).toBe(false)
    expect(swipe(screen.getByRole('tablist'), { deltaX: 110 })).toBe(false)
    await elapse()
    expectFolder('Home')
  })
})
