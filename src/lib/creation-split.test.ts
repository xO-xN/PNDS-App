import { describe, expect, it } from 'vitest'
import { creationSplit } from './creation-split'

describe('creation center / monitor bounds', () => {
  it('keeps both panes readable at the minimum 1000px window', () => {
    expect(creationSplit(1000, 226, 0.4).monitor).toBeCloseTo(306.4)
    expect(creationSplit(1000, 226, 0.6).monitor).toBe(426)
    expect(creationSplit(1000, 226, 0.25).monitor).toBe(280)
  })
  it('keeps both panes present if the host becomes narrower than the supported minimum', () => {
    expect(creationSplit(720, 226, 0.6).monitor).toBeCloseTo(218.7)
    expect(creationSplit(0, 226, 0.4)).toMatchObject({
      available: 0,
      monitor: 0,
    })
  })
})
