/// <reference lib="webworker" />
import { evaluate } from './engine'
import type { EvalContext, EvalResult } from './engine/types'

// Thin transport over the formula engine. The engine is pure, null-aware, and
// safe-by-construction (no eval / new Function, only known columns + functions).
type Req = { formula: string } & EvalContext

self.onmessage = (e: MessageEvent<Req>) => {
  const { formula, columns, entityCount } = e.data
  const res: EvalResult = evaluate(formula, { columns, entityCount })
  ;(self as DedicatedWorkerGlobalScope).postMessage(res)
}
