import { describe, expect, it } from 'vitest'
import { coverFogColors } from './cover-colors'

describe('cover color island', () => {
  it('uses the strongest work hue with the approved pastel companion', () => {
    expect(
      coverFogColors(['#000000', '#ff0000', '#fafafa', '#777777'])
    ).toEqual(['hsl(0 100% 45%)', 'hsl(28 100% 79%)'])
    expect(coverFogColors(['#00ff00'])).toEqual([
      'hsl(120 100% 45%)',
      'hsl(148 100% 79%)',
    ])
  })
  it('accepts shorthand and alpha palette colors without invalid CSS', () => {
    for (const color of ['#0f0', '#0f08', '#00ff0088'])
      expect(coverFogColors([color])[0]).toBe('hsl(120 100% 45%)')
  })
  it('keeps the reference green for neutral or utility palettes', () => {
    for (const palette of [[], ['#000', '#fff'], ['var(--pnds-text)']])
      expect(coverFogColors(palette)).toEqual([
        'hsl(160 100% 45%)',
        'hsl(188 100% 79%)',
      ])
  })
})
