// Shareable app state <-> URL hash. Keeps the whole view in the URL so links are reproducible.
import type { BinMethod } from './scale'

export interface AppState {
  mode: 'index' | 'formula'
  index: string // index id (index mode)
  formula: string // raw formula text (formula mode)
  year: number // actual year value
  binMethod: BinMethod
  classes: number
  theme: 'dark' | 'light'
}

export function encodeState(s: AppState): string {
  const p = new URLSearchParams()
  p.set('m', s.mode)
  if (s.mode === 'index') p.set('idx', s.index)
  else p.set('f', s.formula)
  p.set('y', String(s.year))
  p.set('bins', s.binMethod)
  p.set('k', String(s.classes))
  p.set('t', s.theme)
  return p.toString()
}

export function decodeState(hash: string, fallback: AppState): AppState {
  const p = new URLSearchParams(hash.replace(/^#/, ''))
  const mode = p.get('m') === 'formula' ? 'formula' : p.get('m') === 'index' ? 'index' : fallback.mode
  const binMethod: BinMethod = p.get('bins') === 'equal' ? 'equal' : p.get('bins') === 'quantile' ? 'quantile' : fallback.binMethod
  const theme = p.get('t') === 'light' ? 'light' : p.get('t') === 'dark' ? 'dark' : fallback.theme
  const kStr = p.get('k')
  const kRaw = kStr ? Number(kStr) : NaN
  const classes = Number.isFinite(kRaw) && kRaw >= 3 && kRaw <= 9 ? Math.round(kRaw) : fallback.classes
  const yStr = p.get('y')
  const yRaw = yStr ? Number(yStr) : NaN
  const year = Number.isFinite(yRaw) ? Math.round(yRaw) : fallback.year
  return {
    mode,
    index: p.get('idx') ?? fallback.index,
    formula: p.get('f') ?? fallback.formula,
    year,
    binMethod,
    classes,
    theme,
  }
}
