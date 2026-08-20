import { describe, it, expect } from 'vitest'
import { revealScrollTarget } from './list-reveal'

/**
 * v1.2.2 (issue #29): the avoidance-scroll math — top/bottom band
 * avoidance, zero movement for clear cards, and the scroll-bound clamps.
 * Component behavior (who triggers it, which card) lives in the Sidebar
 * scroll tests; here only the arithmetic is under test.
 */
describe('revealScrollTarget (v1.2.2, issue #29)', () => {
  // A uniform column: viewport 400px, content scrolls to 332px.
  const base = {
    cardHeight: 57,
    scrollTop: 0,
    viewportHeight: 400,
    scrollHeight: 732,
  }

  it('a card fully inside the clear zone moves nothing', () => {
    expect(revealScrollTarget({ ...base, cardTop: 50 })).toBeNull()
  })

  it('lifts a top-band card down past the band with the minimal move', () => {
    // Card top sits 10px into the viewport — inside the 26px clear line.
    // Target puts its top at exactly 26; the move (16px) never exceeds
    // fade+gap. (Taller content than `base` so the target is in range.)
    expect(
      revealScrollTarget({
        ...base,
        cardTop: 410,
        scrollTop: 400,
        scrollHeight: 800,
      })
    ).toBe(384)
  })

  it('lifts a bottom-band card up past the band', () => {
    // Bottom overhang: cardBottom - scrollTop = 382 > 400 - 26.
    expect(revealScrollTarget({ ...base, cardTop: 325 })).toBe(8)
  })

  it('brings a far-off-screen card to the band-clear position on its side', () => {
    // Fully below the fold: lands bottom-clear.
    expect(revealScrollTarget({ ...base, cardTop: 638 })).toBe(321)
    // Fully above: lands top-clear.
    expect(revealScrollTarget({ ...base, cardTop: 100, scrollTop: 300 })).toBe(
      74
    )
  })

  it('clamps to the scroll bounds, and a clamped no-op reports null', () => {
    // Wants -16 → clamps to 0; the scroll already sits at 0 → no move.
    expect(
      revealScrollTarget({ ...base, cardTop: 10, scrollTop: 0 })
    ).toBeNull()
    // Same card while scrolled: clamping to 0 is a real move.
    expect(revealScrollTarget({ ...base, cardTop: 10, scrollTop: 40 })).toBe(0)
    // Wants past the end → clamps to maxScroll.
    expect(revealScrollTarget({ ...base, cardTop: 660, scrollTop: 100 })).toBe(
      332
    )
  })

  it('a column shorter than the viewport can never scroll', () => {
    expect(
      revealScrollTarget({
        ...base,
        cardTop: 5,
        scrollHeight: 300,
      })
    ).toBeNull()
  })

  it('a card taller than the viewport aligns its top below the band', () => {
    expect(
      revealScrollTarget({
        ...base,
        cardTop: 100,
        cardHeight: 500,
        scrollTop: 200,
        scrollHeight: 1000,
      })
    ).toBe(74)
  })
})
