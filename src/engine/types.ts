// Public + internal types for the formula engine. No DOM, no app imports.

/** A data column aligned to the entity list; null = missing for that country. */
export type Column = (number | null)[]

export interface EvalContext {
  /** index id -> column; every column length === entityCount */
  columns: Record<string, Column>
  entityCount: number
}

export interface EvalOptions {
  maxFormulaLength?: number // default 1000
  maxNodes?: number // default 500
}

export interface EvalError {
  message: string
  pos?: number // char offset of the offending token, for UI highlighting
}

export interface EvalResult {
  ok: boolean
  values?: Column // length entityCount; null where the result is missing/undefined
  error?: EvalError
  meta?: { centered: boolean } // true when output is ~zero-centered (hint for diverging scales)
}

export interface FunctionDoc {
  name: string
  kind: 'reducer' | 'normalizer' | 'elementwise'
  arity: number | [number, number]
  signature: string
  description: string
}

/** Error carrying an optional source position. Thrown internally, mapped to EvalError. */
export class EngineError extends Error {
  pos?: number
  constructor(message: string, pos?: number) {
    super(message)
    this.name = 'EngineError'
    this.pos = pos
  }
}

// ---- internal AST / tokens ----

export type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'lp'; pos: number }
  | { t: 'rp'; pos: number }
  | { t: 'comma'; pos: number }

export type Node =
  | { k: 'num'; v: number; pos: number }
  | { k: 'id'; v: string; pos: number }
  | { k: 'unary'; op: string; x: Node; pos: number }
  | { k: 'binary'; op: string; a: Node; b: Node; pos: number }
  | { k: 'call'; name: string; args: Node[]; pos: number }
