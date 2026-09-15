/**
 * v1.5.0 (README cover page): the title fit's branch decision, pure —
 * ProjectCoverPage's effect gathers honest measurements (zone-based
 * available width, Range-based text width, a MEASURED width-per-spacing
 * slope) and applies the returned plan verbatim. Kept out of the
 * component file so Fast Refresh stays component-only and the math is
 * unit-testable.
 *
 * The projection user report that drove this shape (某比例下 title 字
 * 距离突然过大且溢出) traced to the old fit reading
 * `title.scrollWidth/clientWidth`, which a centered nowrap flex child
 * clamps to its own box — every branch decision was made against
 * garbage-equal numbers, so at some proportions the "fits at 0.37em"
 * branch fired on a title that physically overflowed.
 */
export function planTitleFit({
  available,
  em,
  designWidth,
  zeroWidth,
  unitSlope,
}: {
  /** The column the title may occupy, from the zone's content box. */
  available: number
  /** The title's computed font size (px) — the em the design tracking
   *  and the shrink branch scale against. */
  em: number
  /** Rendered width at the design tracking (0.37em). */
  designWidth: number
  /** Rendered width at zero tracking. */
  zeroWidth: number
  /** MEASURED rendered-width gain per 1px of letter-spacing. Counting
   *  characters instead is wrong the day the DOM wraps glyphs (the
   *  ripple spans) — measure the slope, never count. */
  unitSlope: number
}): { letterSpacing: string; fontSize?: string; textIndent: string } {
  if (designWidth <= available) {
    const tracking = 0.37 * em
    return { letterSpacing: `${tracking}px`, textIndent: `${tracking}px` }
  }
  if (zeroWidth <= available && unitSlope > 0) {
    const spacing = Math.max(0, (available - zeroWidth) / unitSlope)
    return { letterSpacing: `${spacing}px`, textIndent: `${spacing}px` }
  }
  return {
    letterSpacing: '0px',
    fontSize: `${(em * available) / zeroWidth}px`,
    textIndent: '0px',
  }
}
