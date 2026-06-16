import { describe, it, expect } from 'vitest'
import { tokenize } from './lexer'
import { parse } from './parser'
import { EngineError } from './types'
import type { Node } from './types'

const ast = (s: string): Node => parse(tokenize(s))
const errPos = (s: string): number | null => {
  try { ast(s); return null } catch (e) { return (e as EngineError).pos ?? -1 }
}

describe('parser', () => {
  it('precedence: a + b * c', () => {
    const n = ast('a + b * c')
    expect(n.k).toBe('binary')
    expect((n as any).op).toBe('+')
    expect((n as any).b.op).toBe('*')
  })
  it('^ is right-associative: 2^3^2', () => {
    const n = ast('2^3^2') as any
    expect(n.op).toBe('^')
    expect(n.a.v).toBe(2)
    expect(n.b.op).toBe('^') // 3^2
  })
  it('unary minus binds looser than ^: -a^2 -> -(a^2)', () => {
    const n = ast('-a^2') as any
    expect(n.k).toBe('unary')
    expect(n.x.op).toBe('^')
  })
  it('calls with args', () => {
    const z = ast('zscore(x)') as any
    expect(z.k).toBe('call')
    expect(z.name).toBe('zscore')
    expect(z.args).toHaveLength(1)
    const q = ast('quantile(c, 0.9)') as any
    expect(q.args).toHaveLength(2)
    expect(q.args[1].v).toBe(0.9)
  })
  it('reports errors with positions', () => {
    expect(errPos('a +')).toBe(3) // end
    expect(errPos('f(a,)')).toBe(4) // the ')'
    expect(errPos('(a')).toBe(2) // missing )
    expect(errPos('a b')).toBe(2) // trailing token
  })
})
