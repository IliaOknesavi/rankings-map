// Tokenizer: source string -> Tok[] with char positions.
import type { Tok } from './types'
import { EngineError } from './types'

const TWO = ['<=', '>=', '==', '!=']
const ONE = '+-*/^<>'
const IDENT = /[A-Za-z0-9_]/

export function tokenize(src: string): Tok[] {
  const toks: Tok[] = []
  let i = 0
  while (i < src.length) {
    const c = src[i]
    if (c === ' ' || c === '\t' || c === '\n' || c === '\r') {
      i++
      continue
    }
    const pos = i
    if (c === '(') { toks.push({ t: 'lp', pos }); i++; continue }
    if (c === ')') { toks.push({ t: 'rp', pos }); i++; continue }
    if (c === ',') { toks.push({ t: 'comma', pos }); i++; continue }
    // number (allow leading dot: .5)
    if ((c >= '0' && c <= '9') || (c === '.' && src[i + 1] >= '0' && src[i + 1] <= '9')) {
      let j = i
      while (j < src.length && ((src[j] >= '0' && src[j] <= '9') || src[j] === '.')) j++
      const text = src.slice(i, j)
      const v = Number(text)
      if (!Number.isFinite(v)) throw new EngineError(`Некорректное число '${text}'`, pos)
      toks.push({ t: 'num', v, pos })
      i = j
      continue
    }
    // identifier
    if ((c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_') {
      let j = i
      while (j < src.length && IDENT.test(src[j])) j++
      toks.push({ t: 'id', v: src.slice(i, j), pos })
      i = j
      continue
    }
    // two-char then one-char operator
    const two = src.slice(i, i + 2)
    if (TWO.includes(two)) { toks.push({ t: 'op', v: two, pos }); i += 2; continue }
    if (ONE.includes(c)) { toks.push({ t: 'op', v: c, pos }); i++; continue }
    throw new EngineError(`Неизвестный символ '${c}'`, pos)
  }
  return toks
}
