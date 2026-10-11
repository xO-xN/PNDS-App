/**
 * The sidebar's geometry provider for useCardDrag (v1.3.2, issue #75):
 * project-list rectangles snapshotted when a press activates — the machine itself stays
 * generic and measurement-free. Everything is queried from the press
 * context's nav subtree ([data-project-scroll]), so the adapter needs no refs handed through
 * render. Folder choices appear only during a project drag; they do not
 * yield and are measured live so the menu can scroll independently.
 */
import { projectDropAt, type DragHitSpace, type Rect } from '@/lib/drag-reorder'
import type { CardDragAdapter, CardDragPress } from '@/hooks/use-card-drag'
import { CARD_SELECTOR } from '@/lib/selection-pills'
import { useProjectStore } from '@/store/project-store'

/** One drag source — a visible user project card. */
export interface DragSource {
  kind: 'project'
  path: string
}

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

/** The temporary folder choices never yield. Their live boxes also account
 * for scrolling the choices after a drag has started. */
function folderChoiceAt(nav: HTMLElement | null, x: number, y: number) {
  const viewport = navElementOf(nav, '[data-folder-drop-choices]')
  if (!viewport || !containsPoint(viewport, x, y)) return null
  for (const element of viewport.querySelectorAll(
    '[data-folder-drop-id], [data-unfiled-drop]'
  )) {
    if (!containsPoint(element, x, y)) continue
    if (element.hasAttribute('data-unfiled-drop'))
      return { kind: 'breadcrumb' as const }
    const index = useProjectStore
      .getState()
      .projectFolders.findIndex(
        folder => folder.id === element.getAttribute('data-folder-drop-id')
      )
    if (index >= 0) return { kind: 'folder' as const, index }
  }
  return null
}

function containsPoint(element: Element, x: number, y: number): boolean {
  const rect = element.getBoundingClientRect()
  return (
    rect.width > 0 &&
    rect.height > 0 &&
    x >= rect.left &&
    x <= rect.right &&
    y >= rect.top &&
    y <= rect.bottom
  )
}

/**
 * The sidebar's adapter — a module constant: it holds no state and reads
 * everything from the press context at activation time. Scoping invariant:
 * the project list and temporary membership choices live in the sidebar's
 * single `<nav>` subtree, which this adapter derives itself.
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
    const stride = inRun
      ? next.getBoundingClientRect().top - rect.top
      : rect.height + 4
    const container = navElementOf(navEl, '[data-project-scroll]')
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
        list: hitSpaceOf(navEl?.querySelectorAll(CARD_SELECTOR)),
        folders: null,
        breadcrumb: null,
      },
      dropAt: (x, y, spaces) =>
        folderChoiceAt(navEl, x, y) ?? projectDropAt(x, y, spaces),
      scroll: container && viewport ? { container, viewport } : null,
    }
  },
}
