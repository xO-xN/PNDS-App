import { describe, it, expect } from 'vitest'
import {
  applyCardSelectionPill,
  applyFolderPill,
  CARD_SELECTOR,
} from './selection-pills'

/**
 * The pill policies against plain jsdom nodes (no store seeding, no
 * React): the geometry writes, the anchor/slide protocol and the
 * reappear-vs-slide decision. jsdom lays nothing out, so offsets are
 * stated the way the engine reads them.
 */
function pinned(
  attributes: Record<string, string>,
  offsets: { left?: number; width?: number; top?: number; height?: number }
): HTMLDivElement {
  const el = document.createElement('div')
  for (const [key, value] of Object.entries(attributes)) {
    el.setAttribute(key, value)
  }
  const define = (prop: string, value: number | undefined) => {
    if (value === undefined) return
    Object.defineProperty(el, prop, { configurable: true, get: () => value })
  }
  define('offsetLeft', offsets.left)
  define('offsetWidth', offsets.width)
  define('offsetTop', offsets.top)
  define('offsetHeight', offsets.height)
  return el
}

describe('CARD_SELECTOR', () => {
  it('declares the card attribute the pill, the reveal and the drag share', () => {
    // One contract for finding a project card — the drag adapter's
    // hit-space query and Sidebar's reveal scan import the same constant.
    expect(CARD_SELECTOR).toBe('[data-project-path]')
  })
})

describe('applyFolderPill (v1.2.2 issue #28 policy)', () => {
  it('covers the active folder segment with its measured x geometry', () => {
    const pill = document.createElement('div')
    const segment = pinned({}, { left: 104, width: 80 })
    const segments = new Map([['gig', segment]])

    applyFolderPill(pill, 'gig', segments, null)

    expect(pill.style.transform).toBe('translateX(104px)')
    expect(pill.style.width).toBe('80px')
  })

  it('a null active folder targets the unfiled segment instead', () => {
    const pill = document.createElement('div')
    const unfiled = pinned({}, { left: 2, width: 100 })

    applyFolderPill(pill, null, new Map(), unfiled)

    expect(pill.style.transform).toBe('translateX(2px)')
    expect(pill.style.width).toBe('100px')
  })

  it('a pill without a target hands its geometry back to the stylesheet', () => {
    const pill = document.createElement('div')
    // Stale geometry from an earlier view — a missing target must clear
    // it, not leave the pill parked over a removed segment.
    pill.style.transform = 'translateX(104px)'
    pill.style.width = '80px'

    applyFolderPill(pill, 'gone', new Map(), null)

    expect(pill.style.transform).toBe('')
    expect(pill.style.width).toBe('')
  })

  it('tolerates a null pill as a no-op (late unmount re-measure)', () => {
    expect(() => applyFolderPill(null, null, new Map(), null)).not.toThrow()
  })
})

describe('applyCardSelectionPill (anchor/slide protocol)', () => {
  function containerOf(...cards: HTMLDivElement[]): HTMLDivElement {
    const container = document.createElement('div')
    for (const card of cards) container.appendChild(card)
    return container
  }

  it('covers the selected card with its measured y geometry and shows it', () => {
    const pill = document.createElement('div')
    const card = pinned({ 'data-project-path': '/a' }, { top: 61, height: 57 })
    const container = containerOf(card)

    applyCardSelectionPill(pill, container, '/a', false)

    expect(pill.style.transform).toBe('translateY(61px)')
    expect(pill.style.height).toBe('57px')
    expect(pill.style.opacity).toBe('1')
    expect(pill.dataset.anchor).toBe('/a')
  })

  it('hidden covers drags and snap frames without dropping the geometry', () => {
    const pill = document.createElement('div')
    const card = pinned({ 'data-project-path': '/a' }, { top: 61, height: 57 })

    applyCardSelectionPill(pill, containerOf(card), '/a', true)

    expect(pill.style.transform).toBe('translateY(61px)')
    expect(pill.style.opacity).toBe('0')
    // The anchor still advances — the hidden frames ride a live selection.
    expect(pill.dataset.anchor).toBe('/a')
  })

  it('no target hides the pill and keeps the last geometry and anchor', () => {
    const pill = document.createElement('div')
    const card = pinned({ 'data-project-path': '/a' }, { top: 61, height: 57 })
    applyCardSelectionPill(pill, containerOf(card), '/a', false)

    // The selection moved to a card the current view does not show (a
    // folder switch): opacity drops, but nothing else moves — the pill
    // must not animate toward a collapsed position.
    applyCardSelectionPill(pill, containerOf(card), '/elsewhere', false)

    expect(pill.style.opacity).toBe('0')
    expect(pill.style.transform).toBe('translateY(61px)')
    expect(pill.style.height).toBe('57px')
    expect(pill.dataset.anchor).toBe('/a')
  })

  it('a null container behaves like an empty view', () => {
    const pill = document.createElement('div')
    pill.dataset.anchor = '/a'

    applyCardSelectionPill(pill, null, '/a', false)

    expect(pill.style.opacity).toBe('0')
    expect(pill.dataset.anchor).toBe('/a')
  })

  it('slides between two visible cards: the move animates', () => {
    const pill = document.createElement('div')
    const first = pinned({ 'data-project-path': '/a' }, { top: 0, height: 57 })
    const second = pinned(
      { 'data-project-path': '/b' },
      { top: 61, height: 57 }
    )
    const container = containerOf(first, second)
    applyCardSelectionPill(pill, container, '/a', false)

    // The anchored card is still visible and the target is another card —
    // a real slide: the stylesheet-owned transition stays armed.
    applyCardSelectionPill(pill, container, '/b', false)

    expect(pill.style.transition).toBe('')
    expect(pill.style.transform).toBe('translateY(61px)')
    expect(pill.dataset.anchor).toBe('/b')
  })

  it('reappears in place when the anchored card left the view', () => {
    const pill = document.createElement('div')
    const first = pinned({ 'data-project-path': '/a' }, { top: 0, height: 57 })
    applyCardSelectionPill(pill, containerOf(first), '/a', false)
    expect(pill.style.transition).toBe('none')

    // A folder switch replaced the list: /a is gone, so sliding from its
    // geometry would be meaningless — the pill snaps (transition none)
    // onto the new card.
    const fresh = pinned({ 'data-project-path': '/c' }, { top: 0, height: 57 })
    applyCardSelectionPill(pill, containerOf(fresh), '/c', false)

    expect(pill.style.transition).toBe('none')
    expect(pill.style.transform).toBe('translateY(0px)')
    expect(pill.dataset.anchor).toBe('/c')
  })

  it('re-selecting the anchored card re-snaps rather than slides', () => {
    const pill = document.createElement('div')
    const card = pinned({ 'data-project-path': '/a' }, { top: 0, height: 57 })

    applyCardSelectionPill(pill, containerOf(card), '/a', false)
    applyCardSelectionPill(pill, containerOf(card), '/a', false)

    expect(pill.style.transition).toBe('none')
  })

  it('restores the transition one frame after a snap', async () => {
    const pill = document.createElement('div')
    const card = pinned({ 'data-project-path': '/a' }, { top: 0, height: 57 })

    applyCardSelectionPill(pill, containerOf(card), '/a', false)
    expect(pill.style.transition).toBe('none')

    await new Promise<void>(resolve => {
      // Two nested rAFs, mirroring the engine's double-frame restore.
      requestAnimationFrame(() => requestAnimationFrame(() => resolve()))
    })

    expect(pill.style.transition).toBe('')
  })

  it('a new anchor restarts the theme rise animation (#41 Brutal)', () => {
    const pill = document.createElement('div')
    const first = pinned({ 'data-project-path': '/a' }, { top: 0, height: 57 })
    const second = pinned(
      { 'data-project-path': '/b' },
      { top: 61, height: 57 }
    )
    const container = containerOf(first, second)
    applyCardSelectionPill(pill, container, '/a', false)

    // The reset-reflow-restore idiom ends with the animation handed back
    // to the stylesheet (the reflow itself has no jsdom observable).
    applyCardSelectionPill(pill, container, '/b', false)
    expect(pill.style.animation).toBe('')

    // Re-applying onto the SAME anchor does not restart it.
    pill.style.animation = 'someKeyframe 1ms'
    applyCardSelectionPill(pill, container, '/b', false)
    expect(pill.style.animation).toBe('someKeyframe 1ms')
  })

  it('tolerates a null pill as a no-op', () => {
    expect(() => applyCardSelectionPill(null, null, '/a', false)).not.toThrow()
  })
})
