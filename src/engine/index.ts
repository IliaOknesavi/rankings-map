// Public API of the formula engine. Stable contract — designed to be extractable to a package.
import type { EvalContext, EvalOptions, EvalResult, Column, FunctionDoc, Node, EvalError } from './types'
import { EngineError } from './types'
import { tokenize } from './lexer'
import { parse as parseTokens } from './parser'
import { evalNode } from './evaluate'
import { DOCS } from './functions'
import { present, mean, std } from './stats'

export * from './types'

export const ENGINE_VERSION = '0.1.0'
export const LANG_VERSION = 1

export function listFunctions(): FunctionDoc[] {
  return DOCS
}

export function parse(formula: string): { ok: boolean; error?: EvalError } {
  try {
    parseTokens(tokenize(formula))
    return { ok: true }
  } catch (e) {
    return { ok: false, error: errOf(e) }
  }
}

export function evaluate(formula: string, ctx: EvalContext, opts?: EvalOptions): EvalResult {
  const maxLen = opts?.maxFormulaLength ?? 1000
  const maxNodes = opts?.maxNodes ?? 500
  const src = formula.trim()
  if (!src) return { ok: false, error: { message: 'Пустая формула' } }
  if (src.length > maxLen) return { ok: false, error: { message: `Формула длиннее ${maxLen} символов` } }

  let ast: Node
  try {
    ast = parseTokens(tokenize(src))
  } catch (e) {
    return { ok: false, error: errOf(e) }
  }
  if (countNodes(ast) > maxNodes) return { ok: false, error: { message: `Слишком сложная формула (> ${maxNodes} узлов)` } }

  let raw: number | Column
  try {
    raw = evalNode(ast, ctx)
  } catch (e) {
    return { ok: false, error: errOf(e) }
  }

  const n = ctx.entityCount
  const values: Column = Array.isArray(raw)
    ? raw.map((v) => (v != null && Number.isFinite(v) ? v : null))
    : Array(n).fill(Number.isFinite(raw) ? raw : null)

  const p = present(values)
  const m = mean(p)
  const s = std(p)
  const centered = p.length > 0 && (Math.abs(m) < 1e-6 || Math.abs(m) < 0.05 * s)
  return { ok: true, values, meta: { centered } }
}

function countNodes(n: Node): number {
  switch (n.k) {
    case 'num':
    case 'id':
      return 1
    case 'unary':
      return 1 + countNodes(n.x)
    case 'binary':
      return 1 + countNodes(n.a) + countNodes(n.b)
    case 'call':
      return 1 + n.args.reduce((s, a) => s + countNodes(a), 0)
  }
}

function errOf(e: unknown): EvalError {
  if (e instanceof EngineError) return { message: e.message, pos: e.pos }
  return { message: e instanceof Error ? e.message : String(e) }
}
