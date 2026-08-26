import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { useEffect } from 'react'
import { render, fireEvent, screen, waitFor } from '@testing-library/react'
import { projectDropAt } from '@/lib/drag-reorder'
import {
  useCardDrag,
  type ActiveDropTarget,
  type CardDragActivation,
  type CardDragAdapter,
  type CardDragController,
} from './use-card-drag'

/**
 * The drag controller's own tests (v1.3.2, issue #75): the machine runs on
 * injected numbers — the adapter below hands it plain geometry, so nothing
 * here pins a getBoundingClientRect. The sidebar's end-to-end drag tests
 * (folder-drag / list / scroll) still exercise the same machine through
 * the real adapter; this file owns the machine's own branches.
 */

interface TestSource {
  id: string
}

/** A uniform 8-card column at y 100..588, cards 57px / stride 61px. */
const LIST_SPACES: CardDragActivation['spaces'] = {
  list: {
    top: 100,
    left: 20,
    right: 300,
    cardHeight: 57,
    stride: 61,
    count: 8,
  },
  folders: null,
  breadcrumb: null,
}

const GHOST: CardDragActivation['ghost'] = {
  x: 10,
  y: 120,
  width: 280,
  height: 57,
  offsetX: 30,
  offsetY: 40,
  stride: 61,
}

/** Numeric adapter: real drop math over injected spaces, no DOM measurement.
 * Clones the spaces per activation — the controller treats the snapshot it
 * is handed as its own (scroll re-anchoring writes into it), exactly like
 * the sidebar adapter's fresh measurements. */
function numericAdapter(overrides: Partial<CardDragActivation> = {}): {
  adapter: CardDragAdapter<TestSource>
  activate: ReturnType<typeof vi.fn>
} {
  const activate = vi.fn(
    (): CardDragActivation => ({
      ghost: GHOST,
      spaces: {
        ...LIST_SPACES,
        list: LIST_SPACES.list ? { ...LIST_SPACES.list } : null,
      },
      dropAt: (x, y, spaces) => projectDropAt(x, y, spaces),
      scroll: null,
      ...overrides,
    })
  )
  return { adapter: { activate }, activate }
}

/** A scroll container with fully pinned scroll metrics (jsdom lays out
 * nothing; scrollTop writes are recorded so the loop can be asserted). */
function fakeScrollContainer(
  metrics: { scrollHeight?: number; clientHeight?: number } = {}
): HTMLElement & { scrollTopWrites: number[] } {
  const el = document.createElement('div')
  const writes: number[] = []
  let top = 0
  Object.defineProperty(el, 'scrollTop', {
    configurable: true,
    get: () => top,
    set: (value: number) => {
      top = value
      writes.push(value)
    },
  })
  Object.defineProperty(el, 'scrollHeight', {
    configurable: true,
    get: () => metrics.scrollHeight ?? 800,
  })
  Object.defineProperty(el, 'clientHeight', {
    configurable: true,
    get: () => metrics.clientHeight ?? 400,
  })
  return Object.assign(el, { scrollTopWrites: writes })
}

let control: CardDragController<TestSource> | null = null
type CommitSpy = ReturnType<
  typeof vi.fn<(source: TestSource, target: ActiveDropTarget) => boolean>
>
let lastOnCommit: CommitSpy | null = null

/** Harness: one draggable card, the floating clone, and the controller
 * captured into `control` from an effect (a render-phase assignment would
 * be a side effect — the compiler lint rightly blocks it). Render reads
 * go through destructured locals, the Sidebar's own pattern. */
function Harness(props: {
  adapter: CardDragAdapter<TestSource>
  onCommit: (source: TestSource, target: ActiveDropTarget) => boolean
}) {
  const controller = useCardDrag<TestSource>(props)
  const { drag, ghost, cloneRef, press } = controller
  useEffect(() => {
    control = controller
  })
  return (
    <>
      <nav>
        <div
          data-testid="card"
          data-card="a"
          onPointerDown={e => press({ id: 'a' }, e, '[data-card]')}
        >
          Card
        </div>
      </nav>
      {drag && (
        <div
          ref={cloneRef}
          data-testid="clone"
          style={{
            transform: `translate(${ghost?.x}px, ${ghost?.y}px)`,
          }}
        />
      )}
    </>
  )
}

function mount(
  adapter: CardDragAdapter<TestSource>,
  onCommit: (source: TestSource, target: ActiveDropTarget) => boolean = () =>
    false
) {
  lastOnCommit = vi.fn(onCommit)
  render(<Harness adapter={adapter} onCommit={lastOnCommit} />)
}

const SOURCE: TestSource = { id: 'a' }

/** Press the card at (40, 80); move to (x, y) — past the click slack when
 * the travel exceeds 4px manhattan, activating the drag. */
function pressAndMove(x: number, y: number) {
  fireEvent.pointerDown(screen.getByTestId('card'), {
    pointerId: 1,
    button: 0,
    clientX: 40,
    clientY: 80,
  })
  fireEvent.pointerMove(window, { pointerId: 1, clientX: x, clientY: y })
}

beforeEach(() => {
  control = null
  lastOnCommit = null
})

describe('press activation', () => {
  it('activates only past the click slack; the adapter measures, the machine consumes', async () => {
    const { adapter, activate } = numericAdapter()
    mount(adapter)

    pressAndMove(42, 80) // 2px — inside the slack
    expect(activate).not.toHaveBeenCalled()
    expect(control?.drag).toBeNull()
    expect(screen.queryByTestId('clone')).not.toBeInTheDocument()

    fireEvent.pointerUp(window, { pointerId: 1 })

    pressAndMove(60, 90) // 30px — past the slack
    await waitFor(() => expect(control?.drag).toEqual(SOURCE))
    expect(activate).toHaveBeenCalledTimes(1)
    expect(activate.mock.calls[0]?.[0]).toMatchObject({
      source: SOURCE,
      pointer: { x: 60, y: 90 },
    })
    expect(control?.ghost).toEqual(GHOST)
  })

  it('a secondary-button press never arms the drag', () => {
    const { adapter, activate } = numericAdapter()
    mount(adapter)

    fireEvent.pointerDown(screen.getByTestId('card'), {
      pointerId: 1,
      button: 2,
      clientX: 40,
      clientY: 80,
    })
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 80, clientY: 120 })

    expect(activate).not.toHaveBeenCalled()
    expect(control?.drag).toBeNull()
  })
})

describe('clone transform and drop resolution', () => {
  it('the clone tracks the pointer through the ghost grab offsets', async () => {
    const { adapter } = numericAdapter()
    mount(adapter)

    pressAndMove(60, 90)
    const clone = await screen.findByTestId('clone')

    fireEvent.pointerMove(window, { pointerId: 1, clientX: 230, clientY: 240 })
    expect(clone.style.transform).toBe('translate(200px, 200px)')
  })

  it('resolves the drop target against the injected spaces (midpoint rule)', async () => {
    const { adapter } = numericAdapter()
    mount(adapter)

    pressAndMove(60, 90)
    await waitFor(() => expect(control?.drag).toEqual(SOURCE))

    // Card 2 spans y 222..279; 250 sits above its midpoint 250.5 → before.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 250 })
    expect(control?.dropTarget).toEqual({
      kind: 'list',
      index: 2,
      half: 'before',
    })

    // Outside the column horizontally — no target.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 500, clientY: 250 })
    expect(control?.dropTarget).toBeNull()
  })
})

describe('commit and click suppression', () => {
  it('pointerup commits the resolved target; a true return suppresses transitions for two frames', async () => {
    const { adapter } = numericAdapter()
    mount(adapter, () => true)

    pressAndMove(60, 90)
    await waitFor(() => expect(control?.drag).toEqual(SOURCE))
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 250 })

    fireEvent.pointerUp(window, { pointerId: 1 })
    expect(lastOnCommit).toHaveBeenCalledWith(SOURCE, {
      kind: 'list',
      index: 2,
      half: 'before',
    })
    expect(control?.suppressTransition).toBe(true)
    expect(control?.drag).toBeNull()

    await waitFor(() => expect(control?.suppressTransition).toBe(false))
  })

  it('a false commit return keeps transitions on (folder joins never snap)', async () => {
    const { adapter } = numericAdapter()
    mount(adapter, () => false)

    pressAndMove(60, 90)
    await waitFor(() => expect(control?.drag).toEqual(SOURCE))
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 250 })
    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(lastOnCommit).toHaveBeenCalledTimes(1)
    expect(control?.suppressTransition).toBe(false)
  })

  it('the click after a finished drag is consumed exactly once', async () => {
    const { adapter } = numericAdapter()
    mount(adapter)

    pressAndMove(60, 90)
    await waitFor(() => expect(control?.drag).toEqual(SOURCE))
    fireEvent.pointerUp(window, { pointerId: 1 })

    expect(control?.consumeClick()).toBe(true)
    expect(control?.consumeClick()).toBe(false)
  })

  it('clearClickSuppression re-arms click handling for a fresh press', async () => {
    const { adapter } = numericAdapter()
    mount(adapter)

    pressAndMove(60, 90)
    await waitFor(() => expect(control?.drag).toEqual(SOURCE))
    fireEvent.pointerUp(window, { pointerId: 1 })

    control?.clearClickSuppression()
    expect(control?.consumeClick()).toBe(false)
  })

  it('pointercancel clears the drag without committing or suppressing the click', async () => {
    const { adapter } = numericAdapter()
    mount(adapter)

    pressAndMove(60, 90)
    await waitFor(() => expect(control?.drag).toEqual(SOURCE))
    fireEvent.pointerCancel(window, { pointerId: 1 })

    expect(lastOnCommit).not.toHaveBeenCalled()
    expect(control?.drag).toBeNull()
    expect(control?.consumeClick()).toBe(false)
  })
})

describe('scrolling drags', () => {
  it('re-anchors the list snapshot on manual scroll and re-resolves under the stationary pointer', async () => {
    const container = fakeScrollContainer()
    const { adapter } = numericAdapter({
      scroll: {
        container,
        viewport: { top: 100, left: 0, right: 320, bottom: 500 },
      },
    })
    mount(adapter)

    pressAndMove(60, 90)
    await waitFor(() => expect(control?.drag).toEqual(SOURCE))

    // Pointer rests over card 3's upper half (y 283..340; 300 → before).
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 300 })
    expect(control?.dropTarget).toEqual({
      kind: 'list',
      index: 3,
      half: 'before',
    })

    // The user scrolls a full stride down: every card moves up 61px in
    // viewport space, so the same stationary pointer now hovers card 4's
    // upper half (y 344..401 shifted to 283..340).
    container.scrollTop = 61
    fireEvent.scroll(container)

    expect(control?.dropTarget).toEqual({
      kind: 'list',
      index: 4,
      half: 'before',
    })
  })

  it('edge auto-scroll advances the container per frame and rests at the bound', async () => {
    vi.useFakeTimers({
      toFake: ['requestAnimationFrame', 'cancelAnimationFrame'],
    })
    const container = fakeScrollContainer()
    const { adapter } = numericAdapter({
      scroll: {
        container,
        viewport: { top: 100, left: 0, right: 320, bottom: 500 },
      },
    })
    mount(adapter)

    pressAndMove(60, 90)
    await waitFor(() => expect(control?.drag).toEqual(SOURCE))

    // Inside the bottom edge band (< 40px above 500) and 14px into card 6
    // (y 466..523) → its upper half.
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 480 })
    expect(control?.dropTarget).toEqual({
      kind: 'list',
      index: 6,
      half: 'before',
    })

    // Frames advance the scroll 14px each; the snapshot follows, so the
    // stationary pointer resolves to later and later cards.
    for (let frame = 0; frame < 5; frame++) {
      vi.advanceTimersByTime(16)
      await waitFor(() => {
        expect(container.scrollTopWrites.at(-1)).toBe(14 * (frame + 1))
      })
    }
    // 5 frames × 14px: top shifted to 30, relative 450 → card 7's slot.
    expect(control?.dropTarget).toEqual({
      kind: 'list',
      index: 7,
      half: 'before',
    })

    // Run the loop to the bottom bound (maxScroll 400 = 800 - 400).
    for (let frame = 0; frame < 60; frame++) {
      vi.advanceTimersByTime(16)
    }
    await waitFor(() => expect(container.scrollTop).toBe(400))
    // The loop rests at the bound — further frames write nothing.
    const writesAtRest = container.scrollTopWrites.length
    for (let frame = 0; frame < 5; frame++) {
      vi.advanceTimersByTime(16)
    }
    expect(container.scrollTopWrites.length).toBe(writesAtRest)
  })

  it('a drag without a scroll scope never arms the loop (static section)', async () => {
    const { adapter } = numericAdapter({ scroll: null })
    mount(adapter)

    pressAndMove(60, 90)
    await waitFor(() => expect(control?.drag).toEqual(SOURCE))
    fireEvent.pointerMove(window, { pointerId: 1, clientX: 100, clientY: 480 })

    expect(control?.dropTarget).not.toBeNull()
  })
})

afterEach(() => {
  vi.useRealTimers()
})
