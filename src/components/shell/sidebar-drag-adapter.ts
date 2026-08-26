/**
 * The sidebar's geometry provider for useCardDrag (v1.3.2, issue #75):
 * every getBoundingClientRect the drag machine consumes, measured against
 * the sidebar's DOM when a press activates — the machine itself stays
 * generic and measurement-free. Everything is queried from the press
 * context's nav subtree ([data-unfiled-segment], [data-project-scroll]),
 * so the adapter needs no refs handed through render. Also picks the
 * drag-reorder resolver the source hit-tests with (project drags resolve
 * breadcrumb → folder segments → list slots; folder drags only ever
 * reorder the row).
 */
import {
  folderDropAt,
  projectDropAt,
  type DragHitSpace,
  type Rect,
} from '@/lib/drag-reorder'
import type { CardDragAdapter, CardDragPress } from '@/hooks/use-card-drag'

/** One drag source — a visible project card or a top-level folder segment. */
export type DragSource =
  | { kind: 'project'; path: string }
  | { kind: 'folder'; id: string }

/**
 * Static slot layout of a uniform card column: the first card's rect plus
 * the pitch measured to the second. Null when the column has no cards.
 */
function hitSpaceOf(
  cards: NodeListOf<Element> | undefined
): DragHitSpace | null {
  const first = cards?.[0]
  if (!(first instanceof HTMLElement)) return null
  const firstRect = first.getBoundingClientRect()
  const second = cards?.[1]
  const stride =
    second instanceof HTMLElement
      ? second.getBoundingClientRect().top - firstRect.top
      : firstRect.height + 4
  return {
    top: firstRect.top,
    left: firstRect.left,
    right: firstRect.right,
    cardHeight: firstRect.height,
    stride,
    count: cards?.length ?? 0,
  }
}

/**
 * The same slot layout for a uniform horizontal row — the folder segments
 * — carried axis-swapped so the row hit-test (hoveredCardInRow) reuses the
 * column math: top = the first segment's left, cardHeight = segment width,
 * left/right = the row's vertical extent, stride = the horizontal pitch.
 */
function rowHitSpaceOf(
  segments: NodeListOf<Element> | undefined
): DragHitSpace | null {
  const first = segments?.[0]
  if (!(first instanceof HTMLElement)) return null
  const firstRect = first.getBoundingClientRect()
  const second = segments?.[1]
  // The switch row packs its segments flush (no gap), so a sole segment
  // pitches by its own width.
  const stride =
    second instanceof HTMLElement
      ? second.getBoundingClientRect().left - firstRect.left
      : firstRect.width
  return {
    top: firstRect.left,
    left: firstRect.top,
    right: firstRect.bottom,
    cardHeight: firstRect.width,
    stride,
    count: segments?.length ?? 0,
  }
}

/** Rect snapshot for point hit-testing (the unfiled segment). */
function rectOf(element: HTMLElement | null): Rect | null {
  if (!element) return null
  const rect = element.getBoundingClientRect()
  return {
    top: rect.top,
    left: rect.left,
    right: rect.right,
    bottom: rect.bottom,
  }
}

/** First element matching `selector` inside the press's nav subtree. */
function navElementOf(nav: HTMLElement | null, selector: string) {
  const found = nav?.querySelector(selector)
  return found instanceof HTMLElement ? found : null
}

/**
 * The sidebar's adapter — a module constant: it holds no state and reads
 * everything from the press context at activation time. Scoping invariant:
 * every drag source, the unfiled segment and the project scroller live in
 * the sidebar's single `<nav>` subtree, which this adapter derives itself.
 */
export const sidebarDragAdapter: CardDragAdapter<DragSource> = {
  activate(press: CardDragPress<DragSource>) {
    const nav = press.card.closest('nav')
    const navEl = nav instanceof HTMLElement ? nav : null
    const rect = press.card.getBoundingClientRect()
    // Pitch between cards measured from the next sibling in the same
    // run drives the yield transforms — vertical for project cards
    // (height + list gap), horizontal for the flush-packed segments.
    const next = press.card.nextElementSibling
    const inRun =
      next instanceof HTMLElement && next.matches(press.cardSelector)
    const stride =
      press.source.kind === 'folder'
        ? inRun
          ? next.getBoundingClientRect().left - rect.left
          : rect.width
        : inRun
          ? next.getBoundingClientRect().top - rect.top
          : rect.height + 4
    // Only the project list scrolls (issue #25): folder drags reorder a
    // static section, so they never arm the loop.
    const container =
      press.source.kind === 'project'
        ? navElementOf(navEl, '[data-project-scroll]')
        : null
    const viewport = rectOf(container)
    return {
      ghost: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
        offsetX: press.pointer.x - rect.left,
        offsetY: press.pointer.y - rect.top,
        stride,
      },
      spaces: {
        list: hitSpaceOf(navEl?.querySelectorAll('[data-project-path]')),
        folders: rowHitSpaceOf(
          navEl?.querySelectorAll('[data-folder-segment]')
        ),
        breadcrumb: rectOf(navElementOf(navEl, '[data-unfiled-segment]')),
      },
      dropAt:
        press.source.kind === 'folder'
          ? (x, y, spaces) => folderDropAt(x, y, spaces.folders)
          : (x, y, spaces) => projectDropAt(x, y, spaces),
      scroll: container && viewport ? { container, viewport } : null,
    }
  },
}
