/**
 * v1.2.2 (issue #29): the avoidance-scroll math for the sidebar's project
 * column — pure like drag-reorder.ts, so jsdom tests pin rects instead of
 * layout.
 *
 * The column wears a static 20px fade mask on both edges (never toggled by
 * scrolling) and pads its ends (26px top / 32px bottom in the Sidebar) so
 * resting content sits clear of the bands. Selection — keyboard or click,
 * one selectedPath chain — scrolls just enough to lift the selected card
 * out of a band: its top must sit at or below fade+gap from the viewport
 * top, or its bottom at or above the symmetric line from the bottom,
 * whichever is the smaller move. A card poking into a band therefore
 * moves at most fade+gap; a card fully clear moves nothing; a card far
 * off-screen lands at the band-clear position on its nearer side.
 */
export interface RevealGeometry {
  /** Card top relative to the scroll content's origin (derive from rects:
   * cardRect.top - containerRect.top + scrollTop — jsdom lays out nothing). */
  cardTop: number
  cardHeight: number
  scrollTop: number
  viewportHeight: number
  scrollHeight: number
}

/** The static fade band on each edge of the column (px). */
export const REVEAL_FADE_BAND = 20
/** Breathing room kept between a revealed card edge and the band (px). */
export const REVEAL_GAP = 6

/**
 * The scrollTop that lifts the card into the clear zone, or null when it
 * is already clear (or the clamped target equals the current scroll — a
 * no-op must not produce a scroll call).
 */
export function revealScrollTarget(geometry: RevealGeometry): number | null {
  const clear = REVEAL_FADE_BAND + REVEAL_GAP
  const maxScroll = Math.max(0, geometry.scrollHeight - geometry.viewportHeight)
  const cardBottom = geometry.cardTop + geometry.cardHeight
  let target: number
  if (geometry.cardTop - geometry.scrollTop < clear) {
    // Top band (or fully above): push the card's top down past the band.
    target = geometry.cardTop - clear
  } else if (
    cardBottom - geometry.scrollTop >
    geometry.viewportHeight - clear
  ) {
    // Bottom band (or fully below): pull the card's bottom up past it.
    target = cardBottom - geometry.viewportHeight + clear
  } else {
    return null
  }
  const clamped = Math.min(Math.max(target, 0), maxScroll)
  return clamped === geometry.scrollTop ? null : clamped
}
