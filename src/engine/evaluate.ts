// Tree-walk evaluator with Desmos-style broadcasting and null propagation.
import type { Node, EvalContext, Column } from './types'
import { EngineError } from './types'
import { REDUCERS, VECFNS, CONSTS } from './functions'
import { present } from './stats'

type Val = number | Column
const isCol = (x: Val): x is Column => Array.isArray(x)
const cell = (v: number): number | null => (Number.isFinite(v) ? v : null)
// own-property check: prevents inherited names (__proto__, toString, constructor) from resolving
const has = (o: object, k: string): boolean => Object.prototype.hasOwnProperty.call(o, k)

const OPS: Record<string, (a: number, b: number) => number> = {
  '+': (a, b) => a + b,
  '-': (a, b) => a - b,
  '*': (a, b) => a * b,
  '/': (a, b) => a / b,
  '^': (a, b) => Math.pow(a, b),
  '<': (a, b) => (a < b ? 1 : 0),
  '<=': (a, b) => (a <= b ? 1 : 0),
  '>': (a, b) => (a > b ? 1 : 0),
  '>=': (a, b) => (a >= b ? 1 : 0),
  '==': (a, b) => (a === b ? 1 : 0),
  '!=': (a, b) => (a !== b ? 1 : 0),
}

function toScalar(x: Val, pos: number): number {
  if (Array.isArray(x)) throw new EngineError('Ожидалось число, а не колонка', pos)
  return x
}

export function evalNode(node: Node, ctx: EvalContext): Val {
  switch (node.k) {
    case 'num':
      return node.v
    case 'id': {
      if (has(CONSTS, node.v)) return CONSTS[node.v]
      if (!has(ctx.columns, node.v)) throw new EngineError(`Неизвестная переменная: ${node.v}`, node.pos)
      const col = ctx.columns[node.v]
      if (col.length !== ctx.entityCount)
        throw new EngineError(`Колонка '${node.v}': длина ${col.length}, ожидалось ${ctx.entityCount}`, node.pos)
      return col
    }
    case 'unary': {
      const x = evalNode(node.x, ctx)
      if (isCol(x)) return x.map((v) => (v == null ? null : cell(-v)))
      return -x
    }
    case 'binary': {
      const a = evalNode(node.a, ctx)
      const b = evalNode(node.b, ctx)
      const f = OPS[node.op]
      if (!isCol(a) && !isCol(b)) return f(a, b)
      if (!isCol(a)) return (b as Column).map((y) => (y == null ? null : cell(f(a, y))))
      if (!isCol(b)) return (a as Column).map((x) => (x == null ? null : cell(f(x, b))))
      const A = a as Column
      const B = b as Column
      return A.map((x, idx) => (x == null || B[idx] == null ? null : cell(f(x, B[idx] as number))))
    }
    case 'call': {
      const argv = node.args.map((a) => evalNode(a, ctx))
      if (has(REDUCERS, node.name)) {
        const r = REDUCERS[node.name]
        if (node.args.length !== r.arity)
          throw new EngineError(`${node.name}: ожидалось аргументов — ${r.arity}`, node.pos)
        const col = isCol(argv[0]) ? argv[0] : [argv[0] as number]
        const extra = argv.slice(1).map((x, k) => toScalar(x, node.args[k + 1].pos))
        return r.fn(present(col), ...extra)
      }
      if (has(VECFNS, node.name)) {
        const vf = VECFNS[node.name]
        if (node.args.length !== vf.arity)
          throw new EngineError(`${node.name}: ожидалось аргументов — ${vf.arity}`, node.pos)
        const col = isCol(argv[0]) ? argv[0] : (Array(ctx.entityCount).fill(argv[0]) as Column)
        const extra = argv.slice(1).map((x, k) => toScalar(x, node.args[k + 1].pos))
        return vf.fn(col, ...extra)
      }
      throw new EngineError(`Неизвестная функция: ${node.name}`, node.pos)
    }
  }
}
