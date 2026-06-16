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
  it('all-equal column -> degenerate breaks, class 0', () => {
    const b = computeBins([5, 5, 5], 'quantile', 5)!
    expect(b.min).toBe(5)
    expect(b.max).toBe(5)
    expect(classOf(5, b.breaks)).toBe(0)
  })
  it('colorsFor length, clamped to [3,9]', () => {
    expect(colorsFor(5, 'sequential')).toHaveLength(5)
    expect(colorsFor(5, 'diverging')).toHaveLength(5)
    expect(colorsFor(2, 'sequential')).toHaveLength(3) // clamped up
    expect(colorsFor(12, 'sequential')).toHaveLength(9) // clamped down
  })
})
