// Precedence-climbing (Pratt) parser: Tok[] -> AST Node. Throws EngineError{message,pos}.
import type { Tok, Node } from './types'
import { EngineError } from './types'

// low -> high; '^' is right-associative.
const PREC: Record<string, number> = {
  '<': 1, '<=': 1, '>': 1, '>=': 1, '==': 1, '!=': 1,
  '+': 2, '-': 2,
  '*': 3, '/': 3,
  '^': 4,
}
const UNARY_PREC = 4 // unary '-' binds looser than '^', tighter than '*'

export function parse(tokens: Tok[]): Node {
  let i = 0
  const endPos = tokens.length ? tokens[tokens.length - 1].pos + 1 : 0
  const peek = (): Tok | undefined => tokens[i]
  const posAt = (): number => tokens[i]?.pos ?? endPos

  function expr(minPrec: number): Node {
    let left = prefix()
    for (;;) {
      const t = peek()
      if (!t || t.t !== 'op' || !(t.v in PREC) || PREC[t.v] < minPrec) break
      const op = t.v
      const pos = t.pos
      i++
      const nextMin = op === '^' ? PREC[op] : PREC[op] + 1
      const right = expr(nextMin)
      left = { k: 'binary', op, a: left, b: right, pos }
    }
    return left
  }

  function prefix(): Node {
    const t = peek()
    if (t && t.t === 'op' && t.v === '-') {
      i++
      return { k: 'unary', op: '-', x: expr(UNARY_PREC), pos: t.pos }
    }
    if (t && t.t === 'op' && t.v === '+') {
      i++
      return prefix() // unary plus: no-op
    }
    return primary()
  }

  function primary(): Node {
    const t = peek()
    if (!t) throw new EngineError('Неожиданный конец выражения', endPos)
    if (t.t === 'num') { i++; return { k: 'num', v: t.v, pos: t.pos } }
    if (t.t === 'id') {
      i++
      const nx = peek()
      if (nx && nx.t === 'lp') {
        i++ // consume (
        const args: Node[] = []
        if (peek() && peek()!.t !== 'rp') {
          args.push(expr(0))
          while (peek() && peek()!.t === 'comma') {
            i++
            args.push(expr(0))
          }
        }
        const close = peek()
        if (!close || close.t !== 'rp') throw new EngineError('Ожидалась )', posAt())
        i++ // consume )
        return { k: 'call', name: t.v, args, pos: t.pos }
      }
      return { k: 'id', v: t.v, pos: t.pos }
    }
    if (t.t === 'lp') {
      i++
      const e = expr(0)
      const close = peek()
      if (!close || close.t !== 'rp') throw new EngineError('Ожидалась )', posAt())
      i++
      return e
    }
    throw new EngineError('Неожиданный токен', t.pos)
  }

  const node = expr(0)
  if (i < tokens.length) throw new EngineError('Лишний токен', tokens[i].pos)
  return node
}
