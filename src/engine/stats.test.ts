import { describe, it, expect } from 'vitest'
import {
  present, mean, std, min, max, median, total, count, quantile,
  rankAscending, percentileRankAscending,
} from './stats'

describe('stats', () => {
  it('present drops null/NaN/Infinity', () => {
    expect(present([1, null, 3, NaN, Infinity])).toEqual([1, 3])
  })
  it('mean / std (population) / median', () => {
    expect(mean([1, 2, 3])).toBe(2)
    expect(std([2, 4, 4, 4, 5, 5, 7, 9])).toBe(2)
    expect(median([1, 2, 3, 4])).toBe(2.5)
  })
  it('quantile R-7 linear', () => {
    expect(quantile([1, 2, 3, 4], 0.5)).toBe(2.5)
    expect(quantile([1, 2, 3, 4], 0.25)).toBe(1.75)
    expect(quantile([10, 20, 30], 0)).toBe(10)
    expect(quantile([10, 20, 30], 1)).toBe(30)
  })
  it('min / max / total / count', () => {
    expect(min([3, 1, 2])).toBe(1)
    expect(max([3, 1, 2])).toBe(3)
    expect(total([1, 2, 3])).toBe(6)
    expect(count([1, 2, 3])).toBe(3)
  })
  it('empty reducers -> NaN (count -> 0)', () => {
    expect(mean([])).toBeNaN()
    expect(std([])).toBeNaN()
    expect(min([])).toBeNaN()
    expect(quantile([], 0.5)).toBeNaN()
    expect(count([])).toBe(0)
  })
  it('rankAscending with ties averaged', () => {
    expect(rankAscending([30, 10, 20])).toEqual([3, 1, 2])
    expect(rankAscending([10, 10, 20])).toEqual([1.5, 1.5, 3])
  })
  it('percentileRankAscending in [0,1], n==1 -> 0.5', () => {
    expect(percentileRankAscending([10, 20, 30])).toEqual([0, 0.5, 1])
    expect(percentileRankAscending([42])).toEqual([0.5])
  })
})
