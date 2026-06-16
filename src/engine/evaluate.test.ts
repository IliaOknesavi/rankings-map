import { describe, it, expect } from 'vitest'
import { tokenize } from './lexer'
import { parse } from './parser'
import { evalNode } from './evaluate'
import type { EvalContext } from './types'

const ctx: EvalContext = { columns: { a: [1, 2, 3], b: [10, 20, 30] }, entityCount: 3 }
const run = (s: string, c: EvalContext = ctx) => evalNode(parse(tokenize(s)), c)

describe('evaluate (broadcasting)', () => {
  it('scalar∘scalar stays scalar', () => {
    expect(run('2 + 3 * 4')).toBe(14)
    expect(run('2^3^2')).toBe(512)
  })
  it('scalar∘vec and vec∘vec are element-wise', () => {
    expect(run('2 * a')).toEqual([2, 4, 6])
    expect(run('a + b')).toEqual([11, 22, 33])
    expect(run('a * b')).toEqual([10, 40, 90])
  })
  it('reducer collapses to scalar, then broadcasts', () => {
    expect(run('mean(a)')).toBe(2)
    expect(run('a - mean(a)')).toEqual([-1, 0, 1])
  })
  it('null propagation and non-finite -> null', () => {
    const c2: EvalContext = { columns: { a: [1, null], b: [1, 1] }, entityCount: 2 }
    expect(run('a + b', c2)).toEqual([2, null])
    expect(run('a / 0')).toEqual([null, null, null])
  })
  it('headline: zscore(life_exp) * minmax(gdp_pc)', () => {
    const c: EvalContext = {
      columns: { life_exp: [70, 80, 60, 90], gdp_pc: [10000, 40000, 5000, 60000] },
      entityCount: 4,
    }
    const out = run('zscore(life_exp) * minmax(gdp_pc)', c) as (number | null)[]
    expect(out).toHaveLength(4)
    for (const v of out) expect(typeof v).toBe('number')
  })
  it('unknown variable throws', () => {
    expect(() => run('zzz')).toThrow()
  })
})
