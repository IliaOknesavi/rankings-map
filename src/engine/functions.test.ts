import { describe, it, expect } from 'vitest'
import { VECFNS, REDUCERS, DOCS } from './functions'

describe('vec functions', () => {
  it('zscore: normal + zero-variance + null preserved', () => {
    expect(VECFNS.zscore.fn([1, 3])).toEqual([-1, 1])
    expect(VECFNS.zscore.fn([5, 5, 5])).toEqual([0, 0, 0])
    expect(VECFNS.zscore.fn([1, null, 3])).toEqual([-1, null, 1])
  })
  it('minmax: range + zero-range', () => {
    expect(VECFNS.minmax.fn([0, 5, 10])).toEqual([0, 0.5, 1])
    expect(VECFNS.minmax.fn([5, 5])).toEqual([0, 0])
  })
  it('percentile_rank and rank', () => {
    expect(VECFNS.percentile_rank.fn([10, 20, 30])).toEqual([0, 0.5, 1])
    expect(VECFNS.rank.fn([30, 10, 20])).toEqual([3, 1, 2])
    expect(VECFNS.rank.fn([30, null, 20, 10])).toEqual([3, null, 2, 1])
  })
  it('winsorize clamps tails to [p, 1-p] quantiles', () => {
    expect(VECFNS.winsorize.fn([1, 2, 3, 4, 5, 100], 0.2)).toEqual([2, 2, 3, 4, 5, 5])
  })
  it('invert reflects around midrange', () => {
    expect(VECFNS.invert.fn([1, 2, 3])).toEqual([3, 2, 1])
  })
  it('clamp / log / log10 / abs / sqrt with null and domain', () => {
    expect(VECFNS.clamp.fn([-1, 0.5, 2], 0, 1)).toEqual([0, 0.5, 1])
    expect(VECFNS.log.fn([1, Math.E])[0]).toBeCloseTo(0)
    expect(VECFNS.log.fn([0, -1])).toEqual([null, null])
    expect(VECFNS.abs.fn([-3, null, 4])).toEqual([3, null, 4])
    expect(VECFNS.sqrt.fn([4, -1])).toEqual([2, null])
  })
})

describe('reducers + docs', () => {
  it('reducers operate on present-filtered numbers', () => {
    expect(REDUCERS.mean.fn([1, 2, 3])).toBe(2)
    expect(REDUCERS.quantile.fn([1, 2, 3, 4], 0.5)).toBe(2.5)
  })
  it('DOCS covers every function name', () => {
    const names = new Set(DOCS.map((d) => d.name))
    for (const n of Object.keys(REDUCERS)) expect(names.has(n)).toBe(true)
    for (const n of Object.keys(VECFNS)) expect(names.has(n)).toBe(true)
    expect(names.has('percentile_rank')).toBe(true)
  })
})
