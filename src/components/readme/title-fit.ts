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

/**
 * v1.5.0 polish (projection report: title 字间距大且右溢、不居中): the
 * model above decides from measurements taken BEFORE the plan applies —
 * and any one of them can be off in the wild (a fit that ran while the
 * projection webview was still hidden, a font swap between probes, the
 * union-rect's unaccounted trailing space). This refinement takes the
 * RENDERED truth — the applied plan's actual rect, still wider than the
 * column by `overflow` — and pulls the plan in by exactly that much:
 * the tracking shrinks by overflow/slope while any tracking remains,
 * else the type scales to the column. Bounded passes in the component
 * converge; `overflow <= 0` is a no-op so the loop can call it freely.
 */
export function refineTitleFit({
  plan,
  overflow,
  em,
  unitSlope,
}: {
  plan: { letterSpacing: string; fontSize?: string; textIndent: string }
  /** How much the rendered line still exceeds the column (px, ≥ 0). */
  overflow: number
  em: number
  unitSlope: number
}): { letterSpacing: string; fontSize?: string; textIndent: string } {
  if (overflow <= 0) return plan
  const spacing = Number.parseFloat(plan.letterSpacing)
  const next = spacing > 0 ? Math.max(0, spacing - overflow / unitSlope) : 0
  if (next > 0 && unitSlope > 0) {
    // Keep any font-size the plan carried: a refinement may run after
    // an earlier pass already shrank the type.
    return {
      ...plan,
      letterSpacing: `${next}px`,
      textIndent: `${next}px`,
    }
  }
  // The tracking is spent (or was already zero) — the type itself must
  // shrink to the column; scale by the overflow against a nominal
  // title-width estimate, bounded so a pathological input never
  // collapses the type to nothing.
  const scale = Math.max(0.25, 1 - overflow / Math.max(1, em * 16))
  return {
    ...plan,
    letterSpacing: '0px',
    fontSize: `${em * scale}px`,
    textIndent: '0px',
  }
}
