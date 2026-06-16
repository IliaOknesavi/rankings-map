import { describe, it, expect } from 'vitest'
import { tokenize } from './lexer'
import { EngineError } from './types'

describe('lexer', () => {
  it('tokenizes ids, numbers, operators with positions', () => {
    expect(tokenize('a*2')).toEqual([
      { t: 'id', v: 'a', pos: 0 },
      { t: 'op', v: '*', pos: 1 },
      { t: 'num', v: 2, pos: 2 },
    ])
  })
  it('recognizes two-char operators and call syntax', () => {
    expect(tokenize('zscore(x) <= 0.5')).toEqual([
      { t: 'id', v: 'zscore', pos: 0 },
      { t: 'lp', pos: 6 },
      { t: 'id', v: 'x', pos: 7 },
      { t: 'rp', pos: 8 },
      { t: 'op', v: '<=', pos: 10 },
      { t: 'num', v: 0.5, pos: 13 },
    ])
  })
  it('throws on unknown char with position', () => {
    let pos = -1
    try { tokenize('a @ b') } catch (e) { pos = (e as EngineError).pos ?? -1 }
    expect(pos).toBe(2)
  })
})
