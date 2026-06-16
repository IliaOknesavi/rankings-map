import { describe, it, expect } from 'vitest'
import { encodeState, decodeState, type AppState } from './urlstate'

const base: AppState = {
  mode: 'index', index: 'gdp_pc', formula: 'zscore(life_exp)*minmax(gdp_pc)',
  year: 2022, binMethod: 'quantile', classes: 5, theme: 'dark',
}

describe('urlstate', () => {
  it('round-trips index mode', () => {
    const s = decodeState('#' + encodeState(base), base)
    expect(s).toEqual(base)
  })
  it('round-trips formula mode (incl. special chars)', () => {
    const f: AppState = { ...base, mode: 'formula', formula: 'a * (b + 1) - quantile(c, 0.9)' }
    const s = decodeState('#' + encodeState(f), base)
    expect(s.mode).toBe('formula')
    expect(s.formula).toBe(f.formula)
  })
  it('falls back on missing/invalid fields', () => {
    const s = decodeState('#m=index&k=99', base)
    expect(s.classes).toBe(5) // 99 out of [3,9] -> fallback
    expect(s.theme).toBe('dark')
    expect(s.index).toBe('gdp_pc')
  })
  it('empty hash returns fallback', () => {
    expect(decodeState('', base)).toEqual(base)
  })
})
