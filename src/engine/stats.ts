// Null-aware numeric primitives. Reducers operate on present values only.
import type { Column } from './types'

/** Keep only present, finite values (drops null / NaN / ±Infinity). */
export function present(c: Column): number[] {
  const out: number[] = []
  for (const x of c) if (x != null && Number.isFinite(x)) out.push(x)
  return out
}

export function count(v: number[]): number {
  return v.length
}

export function total(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) : NaN
}

export function mean(v: number[]): number {
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : NaN
}

/** Population standard deviation (÷N). */
export function std(v: number[]): number {
  if (!v.length) return NaN
  const m = mean(v)
  return Math.sqrt(v.reduce((a, b) => a + (b - m) * (b - m), 0) / v.length)
}

export function min(v: number[]): number {
  return v.length ? Math.min(...v) : NaN
}

export function max(v: number[]): number {
  return v.length ? Math.max(...v) : NaN
}

/** p-quantile, p in [0,1], linear interpolation (numpy/R-7). */
export function quantile(v: number[], p: number): number {
  if (!v.length) return NaN
  const s = [...v].sort((a, b) => a - b)
  if (p <= 0) return s[0]
  if (p >= 1) return s[s.length - 1]
  const h = (s.length - 1) * p
  const lo = Math.floor(h)
  return s[lo] + (h - lo) * (s[lo + 1] - s[lo])
}

export function median(v: number[]): number {
  return quantile(v, 0.5)
}

/** 1-based ascending ranks (1 = smallest), ties averaged, aligned to input order. */
export function rankAscending(v: number[]): number[] {
  const idx = v.map((val, i) => ({ val, i })).sort((a, b) => a.val - b.val)
  const ranks = new Array<number>(v.length)
  let i = 0
  while (i < idx.length) {
    let j = i
    while (j + 1 < idx.length && idx[j + 1].val === idx[i].val) j++
    const avg = (i + j) / 2 + 1
    for (let k = i; k <= j; k++) ranks[idx[k].i] = avg
    i = j + 1
  }
  return ranks
}

/** Ascending percentile rank in [0,1]: (rank-1)/(n-1); n===1 -> 0.5. Aligned to input order. */
export function percentileRankAscending(v: number[]): number[] {
  const n = v.length
  if (n === 0) return []
  if (n === 1) return [0.5]
  return rankAscending(v).map((r) => (r - 1) / (n - 1))
}
