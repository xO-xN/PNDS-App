/**
 * Generic pointer drag controller (v1.3.2, issue #75), extracted from the
 * sidebar: press arming with a click-activation slack, the floating clone
 * transform, static hit-space snapshots, midpoint drop resolution, edge
 * auto-scroll with its rAF loop, scroll re-anchoring under a stationary
 * pointer, and the one-frame post-commit transition suppression.
 *
 * The controller owns the gesture machine only. The host supplies every
 * measurement through a CardDragAdapter (geometry provider — the
 * controller never touches getBoundingClientRect, so its tests inject
 * plain numbers) and decides what a drop means through onCommit (the
 * sidebar's four structural store actions live there). Pure slot/midpoint
 * math stays in src/lib/drag-reorder.ts.
 */
import { useEffect, useRef, useState } from 'react'
import {
  AUTO_SCROLL_STEP,
  autoScrollDirection,
  sameDropTarget,
  scrollShiftedHitSpace,
  type DragSpaces,
  type FolderDropTarget,
  type ProjectDropTarget,
  type Rect,
} from '@/lib/drag-reorder'

/** Any drop target the zones resolve to while a drag is live. */
export type ActiveDropTarget = ProjectDropTarget | FolderDropTarget

/**
 * Clone anchor snapshot taken when a press activates: pins the floating
 * clone to the pressed card and to the pointer (grab offsets), and
 * carries the card stride the yielding cards translate by.
 */
export interface DragGhost {
  /** Card top-left in viewport coordinates; the clone starts exactly there. */
  x: number
  y: number
  width: number
  height: number
  /** Grab offset inside the card so the clone tracks the pointer 1:1. */
  offsetX: number
  offsetY: number
  /** Card pitch (extent + run gap) the yielding cards translate by. */
  stride: number
}

/** What the adapter measures against: the press the host armed. Any DOM
 * scoping beyond the card itself (an ancestor region, sibling runs) is the
 * adapter's convention — the controller knows no host markup. */
export interface CardDragPress<T> {
  source: T
  card: HTMLElement
  /** The selector that identified the card — sibling-stride runs match it. */
  cardSelector: string
  pointer: { x: number; y: number }
}

/** A scrolling drop section: the controller auto-scrolls and re-anchors
 * against the container, within the viewport rect measured at activation. */
export interface CardDragScrollScope {
  container: HTMLElement
  viewport: Rect
}

/** Everything the controller runs one drag against, measured by the host. */
export interface CardDragActivation {
  ghost: DragGhost
  /** The static zone snapshot — the controller takes ownership: scroll
   * re-anchoring rewrites `spaces.list` in place. Adapters must build a
   * fresh snapshot per activation (the sidebar's does — it measures). */
  spaces: DragSpaces
  /** Zone hit-test dispatch for this source (the adapter picks which of
   *  drag-reorder's resolvers applies); re-invoked on every pointer move
   *  and scroll tick with the (re-anchored) spaces. */
  dropAt(x: number, y: number, spaces: DragSpaces): ActiveDropTarget | null
  /** Null when the source's drop section is static — no auto-scroll, no
   *  scroll re-anchoring for that drag. */
  scroll: CardDragScrollScope | null
}

/** Geometry provider: the host's only contribution besides rendering. */
export interface CardDragAdapter<T> {
  /** Measure the static geometry a drag of this source runs against. */
  activate(press: CardDragPress<T>): CardDragActivation
}

export interface CardDragConfig<T> {
  adapter: CardDragAdapter<T>
  /** A finished drag's commit. Return true when the DOM reorder lands in
   *  this commit — the controller then suppresses the yielding cards'
   *  transitions for the snap frame (their final spots already painted). */
  onCommit(source: T, target: ActiveDropTarget): boolean
}

export interface CardDragController<T> {
  /** The live drag's source — null while idle or only pressed. */
  drag: T | null
  /** The drop target currently resolved under the pointer. */
  dropTarget: ActiveDropTarget | null
  /** Clone anchor snapshot for render; mirrors the internal ref. */
  ghost: DragGhost | null
  /** True for one frame after a committing drop (see onCommit). */
  suppressTransition: boolean
  /** Attach to the floating clone — the controller writes its transform
   *  imperatively per pointer move. */
  cloneRef: React.RefObject<HTMLDivElement | null>
  /** pointerdown on a drag source: arm the press. Only the primary button
   *  drags; a secondary-button press is ignored entirely. */
  press(
    source: T,
    event: React.PointerEvent<HTMLElement>,
    cardSelector: string
  ): void
  /** In the host's onClick: true when this click is a finished drag's own
   *  pointerup and must not act. Consumed either way. */
  consumeClick(): boolean
  /** pointerdown on elements that are not drag sources: every fresh press
   *  re-arms click handling a finished drag left behind. */
  clearClickSuppression(): void
}

/** The pointer must travel this far (px, manhattan) before a card press
 * becomes a drag — below it the gesture stays a click. */
const DRAG_ACTIVATION_SLACK = 4

/** The scrollable range below a container's viewport (0 when it fits). */
function maxScrollOf(container: HTMLElement): number {
  return Math.max(0, container.scrollHeight - container.clientHeight)
}

/**
 * The drag machine. Effects key on the armed-press state and the live-drag
 * state exactly as the sidebar's inline implementation did (v1.1.2 T4/T5,
 * spec issues #8/#9; scroll behavior v1.2.1 issue #25); the config is read
 * through a ref so the host may rebuild adapter/commit per render without
 * disturbing an in-flight gesture.
 */
export function useCardDrag<T>(
  config: CardDragConfig<T>
): CardDragController<T> {
  const [drag, setDrag] = useState<T | null>(null)
  const [dropTarget, setDropTarget] = useState<ActiveDropTarget | null>(null)
  /** Clone origin/stride snapshot; mirrors dragGhostRef for render. */
  const [dragGhost, setDragGhost] = useState<DragGhost | null>(null)
  /** Card press armed by pointerdown, not yet a drag (slack not passed). */
  const [armedPress, setArmedPress] = useState<T | null>(null)
  /** True for one frame after a committed drop (see CardDragConfig). */
  const [suppressTransition, setSuppressTransition] = useState(false)

  const configRef = useRef(config)
  useEffect(() => {
    configRef.current = config
  })

  const dragRef = useRef<T | null>(null)
  const dropTargetRef = useRef<ActiveDropTarget | null>(null)
  const dragGhostRef = useRef<DragGhost | null>(null)
  const dropAtRef = useRef<CardDragActivation['dropAt'] | null>(null)
  /** Armed press source, geometry anchor and origin point. */
  const pressRef = useRef<{
    source: T
    cardSelector: string
    card: HTMLElement | null
    x: number
    y: number
  } | null>(null)
  /** True for the one click right after a real drag — the drop's pointerup
   * must not act as the host's click. Reset on every fresh press. */
  const suppressClickRef = useRef(false)
  const dragSpacesRef = useRef<DragSpaces>({
    list: null,
    folders: null,
    breadcrumb: null,
  })
  const cloneRef = useRef<HTMLDivElement | null>(null)
  /** The scrolling section this drag runs against (null: static section),
   * with the scrollTop the list snapshot was taken at. */
  const scrollScopeRef = useRef<{
    scope: CardDragScrollScope
    baseline: number
  } | null>(null)
  /** Edge auto-scroll state while a drag hovers a viewport edge. */
  const autoScrollDirectionRef = useRef<-1 | 0 | 1>(0)
  const autoScrollRafRef = useRef(0)
  /** Last pointer position — re-resolving the drop target after a scroll
   * tick needs it, because the pointer itself did not move. */
  const lastPointerRef = useRef({ x: 0, y: 0 })

  const press: CardDragController<T>['press'] = (
    source,
    event,
    cardSelector
  ) => {
    if (event.button !== 0) return
    suppressClickRef.current = false
    const card = event.currentTarget.closest(cardSelector)
    pressRef.current = {
      source,
      cardSelector,
      card: card instanceof HTMLElement ? card : null,
      x: event.clientX,
      y: event.clientY,
    }
    setArmedPress(source)
  }

  const clearClickSuppression = () => {
    suppressClickRef.current = false
  }

  const consumeClick = () => {
    if (!suppressClickRef.current) return false
    suppressClickRef.current = false
    return true
  }

  // The armed press: past the slack it becomes a real drag (the [drag]
  // effect's listeners take over); released before that, it was a click
  // and the card's own onClick runs unsuppressed.
  useEffect(() => {
    if (!armedPress) return

    const activate = (event: PointerEvent) => {
      const p = pressRef.current
      if (!p?.card) return
      if (
        Math.abs(event.clientX - p.x) + Math.abs(event.clientY - p.y) <=
        DRAG_ACTIVATION_SLACK
      )
        return
      // All measurement is the adapter's — the machine only consumes the
      // numbers (ghost anchor, static zone snapshots, scroll scope).
      const activation = configRef.current.adapter.activate({
        source: p.source,
        card: p.card,
        cardSelector: p.cardSelector,
        pointer: { x: event.clientX, y: event.clientY },
      })
      dragGhostRef.current = activation.ghost
      setDragGhost(activation.ghost)
      dragSpacesRef.current = activation.spaces
      dropAtRef.current = activation.dropAt
      // The zone snapshot is taken at the current scroll; every later
      // scroll tick re-anchors it.
      scrollScopeRef.current = activation.scroll
        ? {
            scope: activation.scroll,
            baseline: activation.scroll.container.scrollTop,
          }
        : null
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      dragRef.current = p.source
      dropTargetRef.current = null
      setDrag(p.source)
      setDropTarget(null)
      setArmedPress(null)
    }

    const release = () => {
      pressRef.current = null
      setArmedPress(null)
    }

    window.addEventListener('pointermove', activate)
    window.addEventListener('pointerup', release)
    window.addEventListener('pointercancel', release)
    return () => {
      window.removeEventListener('pointermove', activate)
      window.removeEventListener('pointerup', release)
      window.removeEventListener('pointercancel', release)
    }
  }, [armedPress])

  useEffect(() => {
    if (!drag) return

    /** Where a pointer position resolves against the drag's static zone
     * snapshots — the single resolution path for pointer moves and for
     * scroll ticks that move cards under a stationary pointer. */
    const resolveDropTarget = (x: number, y: number) => {
      // All zones are the static snapshots taken at drag start: the
      // yielding cards slide under the pointer, so live rects would make
      // the target flicker as the gap opens and closes.
      const dropAt = dropAtRef.current
      if (!dropAt) return
      const next = dropAt(x, y, dragSpacesRef.current)
      if (sameDropTarget(dropTargetRef.current, next)) return
      dropTargetRef.current = next
      setDropTarget(next)
    }

    /** Re-anchors the list snapshot to the container's current scroll and
     * re-resolves the drop target under the stationary pointer — the
     * cards physically move while the list scrolls. Idempotent through
     * the baseline: a repeat call with no further scroll is a no-op, so
     * the browser's scroll event and the auto-scroll tick can both land
     * here. */
    const syncListScroll = () => {
      const scroll = scrollScopeRef.current
      const spaces = dragSpacesRef.current
      if (!scroll || !spaces.list) return
      const delta = scroll.scope.container.scrollTop - scroll.baseline
      if (delta === 0) return
      scroll.baseline = scroll.scope.container.scrollTop
      spaces.list = scrollShiftedHitSpace(spaces.list, delta)
      resolveDropTarget(lastPointerRef.current.x, lastPointerRef.current.y)
    }

    const stopAutoScroll = () => {
      autoScrollDirectionRef.current = 0
      if (autoScrollRafRef.current) {
        cancelAnimationFrame(autoScrollRafRef.current)
        autoScrollRafRef.current = 0
      }
    }

    const stepAutoScroll = () => {
      autoScrollRafRef.current = 0
      const scroll = scrollScopeRef.current
      const direction = autoScrollDirectionRef.current
      if (!scroll || direction === 0) return
      const container = scroll.scope.container
      const maxScroll = maxScrollOf(container)
      const target = Math.max(
        0,
        Math.min(container.scrollTop + direction * AUTO_SCROLL_STEP, maxScroll)
      )
      if (target !== container.scrollTop) {
        container.scrollTop = target
        // jsdom dispatches no scroll event for a programmatic scrollTop;
        // sync directly so the snapshot follows every frame (in browsers
        // the listener coalesces to a no-op — the delta is applied).
        syncListScroll()
      }
      // At a scroll bound the loop rests; the next pointer move re-arms it
      // if the pointer still sits in the edge band.
      if (container.scrollTop > 0 && container.scrollTop < maxScroll) {
        autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll)
      } else {
        autoScrollDirectionRef.current = 0
      }
    }

    const updateAutoScroll = (x: number, y: number) => {
      const scroll = scrollScopeRef.current
      if (!scroll) {
        stopAutoScroll()
        return
      }
      const container = scroll.scope.container
      autoScrollDirectionRef.current = autoScrollDirection(
        x,
        y,
        scroll.scope.viewport,
        container.scrollTop,
        maxScrollOf(container)
      )
      if (autoScrollDirectionRef.current === 0) stopAutoScroll()
      else if (!autoScrollRafRef.current) {
        autoScrollRafRef.current = requestAnimationFrame(stepAutoScroll)
      }
    }

    const clearDrag = () => {
      stopAutoScroll()
      dragRef.current = null
      dropTargetRef.current = null
      dragGhostRef.current = null
      dropAtRef.current = null
      scrollScopeRef.current = null
      dragSpacesRef.current = { list: null, folders: null, breadcrumb: null }
      setDrag(null)
      setDropTarget(null)
      setDragGhost(null)
    }

    const handlePointerMove = (event: PointerEvent) => {
      // The clone tracks the pointer imperatively — a state update per
      // move would re-render the whole list (performance pattern).
      const ghost = dragGhostRef.current
      if (cloneRef.current && ghost) {
        cloneRef.current.style.transform = `translate(${event.clientX - ghost.offsetX}px, ${event.clientY - ghost.offsetY}px)`
      }
      lastPointerRef.current = { x: event.clientX, y: event.clientY }
      resolveDropTarget(event.clientX, event.clientY)
      updateAutoScroll(event.clientX, event.clientY)
    }

    const finishDrag = () => {
      stopAutoScroll()
      // The ensuing click on the card is the drop's own pointerup — the
      // host's onClick must not treat it as its action.
      suppressClickRef.current = true
      const source = dragRef.current
      const target = dropTargetRef.current
      if (source !== null && target) {
        if (configRef.current.onCommit(source, target)) {
          setSuppressTransition(true)
        }
      }
      clearDrag()
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', finishDrag)
    window.addEventListener('pointercancel', clearDrag)
    // Manual scrolls (wheel/trackpad) during a drag move the cards under
    // the pointer too — keep the snapshot anchored.
    const scrollContainer = scrollScopeRef.current?.scope.container
    scrollContainer?.addEventListener('scroll', syncListScroll)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', finishDrag)
      window.removeEventListener('pointercancel', clearDrag)
      scrollContainer?.removeEventListener('scroll', syncListScroll)
      stopAutoScroll()
    }
  }, [drag])

  // Re-enable card transitions only once the snap frame has painted;
  // cancelled drags (pointercancel, no-commit drops) never pass through
  // here and keep their smooth return animation.
  useEffect(() => {
    if (!suppressTransition) return
    let second = 0
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setSuppressTransition(false))
    })
    return () => {
      cancelAnimationFrame(first)
      cancelAnimationFrame(second)
    }
  }, [suppressTransition])

  return {
    drag,
    dropTarget,
    ghost: dragGhost,
    suppressTransition,
    cloneRef,
    press,
    consumeClick,
    clearClickSuppression,
  }
}
