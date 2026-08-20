import type { ProjectFolder } from '@/lib/tauri-bindings'

/**
 * v1.1.2 T4 (spec issue #8): pure drop/yield geometry for the sidebar's
 * handwritten pointer drag. The component measures rects and renders; every
 * decision — which half of the hovered card wins, where the drop lands, how
 * far each card yields — lives here so it can be unit-tested (jsdom has no
 * layout, so pointer dragging can only be exercised mathematically).
 *
 * All indices refer to the current visible list (top-level ungrouped or one
 * folder's members); an "insertion index" is the slot the dragged card would
 * occupy in that list (0..length), before the removal is accounted for.
 */

/** Which half of the hovered card the pointer is over. */
export type DropHalf = 'before' | 'after'

/** The hovered card (by visible index) plus the winning half. */
export interface DropTarget {
  index: number
  half: DropHalf
}

/**
 * The static slot layout of the visible list, snapshotted when a drag
 * starts: cards sit `stride` px apart starting at `top`, each `cardHeight`
 * px tall, spanning `left`..`right`. Yield transforms never change it —
 * hit-testing against live rects would see cards sliding under the pointer
 * and oscillate, so the snapshot is the single coordinate system for the
 * whole drag.
 */
export interface DragHitSpace {
  top: number
  left: number
  right: number
  cardHeight: number
  stride: number
  count: number
}

/** True when both lists hold exactly the same members, any order. */
export function sameMemberSet(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false
  const aMembers = new Set(a)
  const bMembers = new Set(b)
  // A duplicate on either side is not the same member set.
  return (
    aMembers.size === a.length &&
    bMembers.size === b.length &&
    b.every(item => aMembers.has(item))
  )
}

/**
 * Midpoint rule: the pointer above the hovered card's vertical midpoint
 * drops "before" it, at or below the midpoint drops "after" (spec issue #8:
 * 上半=插前、下半=插后).
 */
export function hoveredHalf(
  pointerY: number,
  card: { top: number; height: number }
): DropHalf {
  return pointerY < card.top + card.height / 2 ? 'before' : 'after'
}

/** Insertion index implied by the hovered card and its winning half. */
export function insertionIndexFor(
  hoveredIndex: number,
  half: DropHalf
): number {
  return half === 'before' ? hoveredIndex : hoveredIndex + 1
}

/**
 * Hit-test a pointer position against the static slot layout: the card
 * whose slot contains the pointer wins, with the half decided by that
 * card's own midpoint (a slot's trailing gap counts as its lower half).
 * Outside the list — horizontally or vertically — no target.
 */
export function hoveredCardAt(
  pointerX: number,
  pointerY: number,
  space: DragHitSpace
): DropTarget | null {
  if (space.stride <= 0 || space.count <= 0) return null
  if (pointerX < space.left || pointerX > space.right) return null
  const relative = pointerY - space.top
  if (relative < 0 || relative >= space.count * space.stride) return null
  const index = Math.floor(relative / space.stride)
  const withinCard = relative - index * space.stride
  return {
    index,
    half: hoveredHalf(withinCard, { top: 0, height: space.cardHeight }),
  }
}

/**
 * The visible order a drop at `insertionIndex` produces. Returns the input
 * reference for no-ops (invalid source, no insertion, or landing back on the
 * original slot), so callers can skip work without deep comparison.
 */
export function reorderedList(
  paths: string[],
  fromIndex: number,
  insertionIndex: number | null
): string[] {
  if (insertionIndex === null) return paths
  if (fromIndex < 0 || fromIndex >= paths.length) return paths
  const insertion = Math.max(0, Math.min(insertionIndex, paths.length))
  // Insertion `fromIndex` or `fromIndex + 1` is where the card already is.
  if (insertion === fromIndex || insertion === fromIndex + 1) return paths
  const next = paths.filter((_, index) => index !== fromIndex)
  const at = insertion > fromIndex ? insertion - 1 : insertion
  const moved = paths[fromIndex]
  if (moved === undefined) return paths
  next.splice(at, 0, moved)
  return next
}

/**
 * Vertical offset (px) for the card at `index` while a drag hovers
 * `insertionIndex`: cards between the dragged card and the gap slide one
 * stride (card height + list gap) towards the dragged card's old slot,
 * opening a full-card-sized hole at the landing position. The dragged card
 * itself never shifts — it is hidden and replaced by the floating clone.
 */
export function cardShift(
  fromIndex: number,
  insertionIndex: number | null,
  index: number,
  stride: number
): number {
  if (insertionIndex === null) return 0
  if (insertionIndex === fromIndex || insertionIndex === fromIndex + 1) return 0
  if (
    insertionIndex > fromIndex &&
    index > fromIndex &&
    index < insertionIndex
  ) {
    return -stride
  }
  if (
    insertionIndex < fromIndex &&
    index >= insertionIndex &&
    index < fromIndex
  ) {
    return stride
  }
  return 0
}

/**
 * Top-level drops reorder only the ungrouped segment, but `recentProjectPaths`
 * stays the master list: rebuild it by swapping each ungrouped slot for the
 * next path of the new order, leaving every folder member in place. A
 * `newUngrouped` that is not a reorder of the current ungrouped set returns
 * the master list untouched.
 */
export function masterWithUngroupedOrder(
  master: string[],
  folders: ProjectFolder[],
  newUngrouped: string[]
): string[] {
  const grouped = new Set(folders.flatMap(folder => folder.projectPaths))
  const ungrouped = master.filter(path => !grouped.has(path))
  if (!sameMemberSet(ungrouped, newUngrouped)) return master
  let cursor = 0
  return master.map(path => {
    if (grouped.has(path)) return path
    const replacement = newUngrouped[cursor]
    cursor += 1
    // Unreachable after the set check, but never corrupt the master list.
    return replacement ?? path
  })
}

/**
 * v1.1.2 T5 (spec issue #9): the drop zones a drag can resolve to beyond
 * the visible-list reorder — dropping a project on a folder card (join it)
 * or on the breadcrumb bar (leave the folder). All rects are the static
 * snapshots taken at drag start, like DragHitSpace.
 */
export interface Rect {
  top: number
  left: number
  right: number
  bottom: number
}

/** True for points inside or on the edge of `rect`. */
export function pointInRect(
  pointerX: number,
  pointerY: number,
  rect: Rect
): boolean {
  return (
    pointerX >= rect.left &&
    pointerX <= rect.right &&
    pointerY >= rect.top &&
    pointerY <= rect.bottom
  )
}

/**
 * Where a dragged project card would land. The zones are disjoint in
 * practice (breadcrumb above the list, folder cards below it), so the
 * precedence here only guards against overlap: breadcrumb, then folder
 * cards, then the in-list reorder slot.
 */
export type ProjectDropTarget =
  | { kind: 'list'; index: number; half: DropHalf }
  | { kind: 'folder'; index: number }
  | { kind: 'breadcrumb' }

/** The drop zones snapshotted at drag start; null where not rendered. */
export interface DragSpaces {
  /** Visible project cards (top-level ungrouped or one folder's members). */
  list: DragHitSpace | null
  /** Folder cards — top level only, hidden while drilled in. */
  folders: DragHitSpace | null
  /** The breadcrumb bar — folder view only. */
  breadcrumb: Rect | null
}

export function projectDropAt(
  pointerX: number,
  pointerY: number,
  spaces: DragSpaces
): ProjectDropTarget | null {
  if (spaces.breadcrumb && pointInRect(pointerX, pointerY, spaces.breadcrumb)) {
    return { kind: 'breadcrumb' }
  }
  if (spaces.folders) {
    const folderHit = hoveredCardAt(pointerX, pointerY, spaces.folders)
    if (folderHit) return { kind: 'folder', index: folderHit.index }
  }
  const listHit = spaces.list
    ? hoveredCardAt(pointerX, pointerY, spaces.list)
    : null
  return listHit
    ? { kind: 'list', index: listHit.index, half: listHit.half }
    : null
}

/**
 * Where a dragged folder card would land: folders only ever reorder within
 * the folder area (spec issue #9: 文件夹卡在文件夹区内可拖拽排序), so the
 * project list is never consulted.
 */
export interface FolderDropTarget {
  kind: 'list'
  index: number
  half: DropHalf
}

export function folderDropAt(
  pointerX: number,
  pointerY: number,
  space: DragHitSpace | null
): FolderDropTarget | null {
  const hit = space ? hoveredCardAt(pointerX, pointerY, space) : null
  return hit ? { kind: 'list', index: hit.index, half: hit.half } : null
}

/**
 * v1.2.1 (issue #25): how deep inside the scrolling list's viewport (px)
 * a dragged card's pointer must hover before the list auto-scrolls.
 */
export const AUTO_SCROLL_EDGE = 40

/** Pixels per animation frame the edge auto-scroll advances the list. */
export const AUTO_SCROLL_STEP = 14

/**
 * Auto-scroll direction for a pointer inside the scrolling project list:
 * -1 near the top edge, +1 near the bottom, 0 elsewhere or where the list
 * cannot scroll further that way. The component's rAF loop applies it
 * while a project drag hovers an edge; folder drags never scroll (their
 * section sits outside the scroll flow).
 */
export function autoScrollDirection(
  pointerX: number,
  pointerY: number,
  viewport: Rect,
  scrollTop: number,
  maxScroll: number
): -1 | 0 | 1 {
  if (pointerX < viewport.left || pointerX > viewport.right) return 0
  if (pointerY < viewport.top || pointerY > viewport.bottom) return 0
  if (pointerY - viewport.top < AUTO_SCROLL_EDGE && scrollTop > 0) return -1
  if (viewport.bottom - pointerY < AUTO_SCROLL_EDGE && scrollTop < maxScroll) {
    return 1
  }
  return 0
}

/**
 * The list's static slot snapshot after its container scrolled by
 * `scrollDelta` px: scrolling down moves every card up by the same amount
 * in viewport space, and nothing else about the layout changes. Called on
 * every scroll tick of a live drag so hit-testing stays anchored to what
 * the list actually shows.
 */
export function scrollShiftedHitSpace(
  space: DragHitSpace,
  scrollDelta: number
): DragHitSpace {
  return { ...space, top: space.top - scrollDelta }
}

/** Structural equality for any mix of the drop-target unions. */
export function sameDropTarget(
  a: ProjectDropTarget | FolderDropTarget | null,
  b: ProjectDropTarget | FolderDropTarget | null
): boolean {
  if (a === b) return true
  if (!a || !b) return false
  if (a.kind !== b.kind) return false
  if (a.kind === 'list' && b.kind === 'list') {
    return a.index === b.index && a.half === b.half
  }
  if (a.kind === 'folder' && b.kind === 'folder') return a.index === b.index
  return true
}
