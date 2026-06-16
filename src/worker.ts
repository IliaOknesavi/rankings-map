/// <reference lib="webworker" />
import { Parser } from 'expr-eval'
import type { FormulaRequest, FormulaResponse, NormMode } from './types'

// Safe formula engine. expr-eval parses to its own AST and evaluates against an
// injected numeric scope only — no eval / new Function, no JS member access.
// Indices are exposed by opaque id; missing inputs propagate to null.

const MAX_FORMULA_LEN = 500

function normalize(col: (number | null)[], mode: NormMode): number[] {
  const present = col.filter((v): v is number => v != null && Number.isFinite(v))
  if (mode === 'none' || present.length === 0) {
    return col.map((v) => (v == null ? NaN : v))
  }
  if (mode === 'zscore') {
    const mean = present.reduce((a, b) => a + b, 0) / present.length
    const variance = present.reduce((a, b) => a + (b - mean) ** 2, 0) / present.length
    const sd = Math.sqrt(variance)
    return col.map((v) => (v == null || sd === 0 ? NaN : (v - mean) / sd))
  }
  // minmax
  const min = Math.min(...present)
  const max = Math.max(...present)
  return col.map((v) => (v == null || max === min ? NaN : (v - min) / (max - min)))
}

self.onmessage = (e: MessageEvent<FormulaRequest>) => {
  const { formula, normMode, entityIds, columns } = e.data
  const reply = (r: FormulaResponse) => (self as DedicatedWorkerGlobalScope).postMessage(r)

  let expr = formula.trim()
  // allow "Name = expression" by taking the right-hand side
  const eq = expr.indexOf('=')
  if (eq >= 0) expr = expr.slice(eq + 1).trim()
  if (!expr) return reply({ error: 'Пустая формула' })
  if (expr.length > MAX_FORMULA_LEN) return reply({ error: 'Формула слишком длинная' })

  let parsed
  try {
    parsed = new Parser().parse(expr)
  } catch (err) {
    return reply({ error: 'Ошибка разбора: ' + (err as Error).message })
  }

  // disallow unknown variables (only index ids are valid)
  const allowed = new Set(Object.keys(columns))
  const used = parsed.variables({ withMembers: false })
  const unknown = used.filter((v) => !allowed.has(v))
  if (unknown.length) return reply({ error: 'Неизвестные переменные: ' + unknown.join(', ') })

  const norm: Record<string, number[]> = {}
  for (const id of allowed) norm[id] = normalize(columns[id], normMode)

  const n = entityIds.length
  const out: (number | null)[] = new Array(n).fill(null)
  for (let i = 0; i < n; i++) {
    const scope: Record<string, number> = {}
    for (const id of allowed) scope[id] = norm[id][i]
    try {
      const r = parsed.evaluate(scope)
      out[i] = typeof r === 'number' && Number.isFinite(r) ? r : null
    } catch {
      out[i] = null
    }
  }
  reply({ values: out })
}
