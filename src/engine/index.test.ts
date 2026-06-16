import { describe, it, expect } from 'vitest'
import { evaluate, parse, listFunctions, ENGINE_VERSION, LANG_VERSION } from './index'
import type { EvalContext } from './types'

const ctx: EvalContext = {
  columns: { a: [1, 2, 3], life_exp: [70, 80, 60, 90], gdp_pc: [10000, 40000, 5000, 60000] },
  entityCount: 3,
}
const ctx4: EvalContext = {
  columns: { life_exp: [70, 80, 60, 90], gdp_pc: [10000, 40000, 5000, 60000] },
  entityCount: 4,
}

describe('public api', () => {
  it('exposes versions', () => {
    expect(ENGINE_VERSION).toBe('0.1.0')
    expect(LANG_VERSION).toBe(1)
  })
  it('empty formula -> error', () => {
    expect(evaluate('   ', ctx).ok).toBe(false)
    expect(evaluate('   ', ctx).error?.message).toBe('Пустая формула')
  })
  it('bare column id returns the column unchanged (equivalence)', () => {
    const r = evaluate('a', ctx)
    expect(r.ok).toBe(true)
    expect(r.values).toEqual([1, 2, 3])
  })
  it('headline end-to-end', () => {
    const r = evaluate('zscore(life_exp) * minmax(gdp_pc)', ctx4)
    expect(r.ok).toBe(true)
    expect(r.values).toHaveLength(4)
    for (const v of r.values!) expect(typeof v).toBe('number')
  })
  it('meta.centered: true for zscore, false for minmax', () => {
    expect(evaluate('zscore(a)', ctx).meta?.centered).toBe(true)
    expect(evaluate('minmax(a)', ctx).meta?.centered).toBe(false)
  })
  it('unknown variable -> error with message', () => {
    const r = evaluate('zzz + 1', ctx)
    expect(r.ok).toBe(false)
    expect(r.error?.message).toContain('Неизвестная переменная')
  })
  it('parse reports position for syntax error', () => {
    const r = parse('a +')
    expect(r.ok).toBe(false)
    expect(typeof r.error?.pos).toBe('number')
  })
  it('maxFormulaLength enforced', () => {
    expect(evaluate('a', ctx, { maxFormulaLength: 0 }).ok).toBe(false)
  })
  it('listFunctions includes percentile_rank', () => {
    expect(listFunctions().some((d) => d.name === 'percentile_rank')).toBe(true)
  })
  it('rejects prototype-chain identifiers (no leak)', () => {
    expect(evaluate('__proto__', ctx).ok).toBe(false)
    expect(evaluate('toString', ctx).ok).toBe(false)
    expect(evaluate('constructor + a', ctx).error?.message).toContain('Неизвестная переменная')
    expect(evaluate('toString(a)', ctx).error?.message).toContain('Неизвестная функция')
  })
  it('errors on mismatched ctx column length', () => {
    const r = evaluate('y', { columns: { y: [5, 6] }, entityCount: 3 })
    expect(r.ok).toBe(false)
    expect(r.error?.message).toContain('длина')
  })
  it('values always has length entityCount', () => {
    expect(evaluate('a', ctx).values).toHaveLength(3)
    expect(evaluate('mean(a)', ctx).values).toHaveLength(3)
  })
})
