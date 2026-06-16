/// <reference lib="webworker" />
import { evaluate } from './engine'
import type { EvalContext, EvalResult } from './engine/types'

// Thin transport over the pure formula engine. Each request carries a seq so the
// main thread can match replies and ignore superseded ones (live slider drags).
type Req = { seq: number; formula: string } & EvalContext

self.onmessage = (e: MessageEvent<Req>) => {
  const { seq, formula, columns, entityCount } = e.data
  const res: EvalResult = evaluate(formula, { columns, entityCount })
  ;(self as DedicatedWorkerGlobalScope).postMessage({ seq, res })
}
