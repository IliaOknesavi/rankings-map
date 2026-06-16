import { describe, it, expect } from 'vitest'
import { computeBins, classOf, colorsFor } from './scale'

describe('scale', () => {
  it('equal-interval breaks', () => {
    const b = computeBins([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 'equal', 5)!
    expect(b.breaks).toEqual([2, 4, 6, 8])
    expect(b.min).toBe(0)
    expect(b.max).toBe(10)
  })
  it('quantile breaks', () => {
    const b = computeBins([1, 2, 3, 4], 'quantile', 2)!
    expect(b.breaks).toEqual([2.5])
  })
  it('classOf assigns 0..k-1 by thresholds', () => {
    const breaks = [2, 4, 6, 8]
    expect(classOf(0, breaks)).toBe(0)
    expect(classOf(5, breaks)).toBe(2)
    expect(classOf(10, breaks)).toBe(4)
    expect(classOf(2, breaks)).toBe(0) // value == break -> lower class
  })
  it('returns null with fewer than 2 present values', () => {
    expect(computeBins([null, 5], 'equal', 5)).toBeNull()
    expect(computeBins([null, null], 'quantile', 5)).toBeNull()
  })
  it('all-equal column -> single class (no phantom breaks)', () => {
    const b = computeBins([5, 5, 5], 'quantile', 5)!
    expect(b.breaks).toEqual([])
    expect(b.k).toBe(1)
    expect(classOf(5, b.breaks)).toBe(0)
  })
  it('dedupes interior breaks on skewed data (no phantom classes)', () => {
    const b = computeBins([0, 0, 0, 0, 0, 0, 0, 0, 1, 100], 'quantile', 5)!
    expect(b.breaks).toHaveLength(1) // the three duplicate 0-breaks are dropped
    expect(b.breaks[0]).toBeCloseTo(0.2)
    expect(b.k).toBe(2)
    expect(classOf(0, b.breaks)).toBe(0)
    expect(classOf(100, b.breaks)).toBe(1)
  })
  it('colorsFor length, clamped to [3,9]', () => {
    expect(colorsFor(5, 'sequential')).toHaveLength(5)
    expect(colorsFor(5, 'diverging')).toHaveLength(5)
    expect(colorsFor(2, 'sequential')).toHaveLength(3) // clamped up
    expect(colorsFor(12, 'sequential')).toHaveLength(9) // clamped down
  })
})
