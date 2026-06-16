// Choropleth binning: classify values into K classes and pick a stepped color palette.
import { schemeYlGnBu, schemeRdBu } from 'd3-scale-chromatic'
import { present, quantile } from './engine/stats'

export type BinMethod = 'equal' | 'quantile'
export interface Bins {
  breaks: number[] // k-1 ascending thresholds
  min: number
  max: number
  k: number
}

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v))

/** Compute K-class breaks over present values. Returns null if fewer than 2 present values. */
export function computeBins(values: (number | null)[], method: BinMethod, k: number): Bins | null {
  const v = present(values)
  if (v.length < 2) return null
  const min = Math.min(...v)
  const max = Math.max(...v)
  const breaks: number[] = []
  if (method === 'equal') {
    const step = (max - min) / k
    for (let i = 1; i < k; i++) breaks.push(min + i * step)
  } else {
    for (let i = 1; i < k; i++) breaks.push(quantile(v, i / k))
  }
  return { breaks, min, max, k }
}

/** Class index 0..k-1: the number of breaks strictly below the value. */
export function classOf(value: number, breaks: number[]): number {
  let c = 0
  for (const b of breaks) if (value > b) c++
  return c
}

/** Stepped palette of length clamp(k,3,9). Sequential (YlGnBu) or diverging (RdBu). */
export function colorsFor(k: number, scheme: 'sequential' | 'diverging'): string[] {
  const kc = clamp(k, 3, 9)
  const table = scheme === 'diverging' ? schemeRdBu : schemeYlGnBu
  return (table[kc] as readonly string[]).slice()
}
