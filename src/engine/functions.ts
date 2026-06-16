// Function catalog: reducers (Vec->Scalar) and vec functions (Vec->Vec), plus constants + docs.
import type { Column, FunctionDoc } from './types'
import {
  present, mean, std, min, max, median, total, count, quantile,
  rankAscending, percentileRankAscending,
} from './stats'

/** Place present-order results back onto column positions; null stays null. */
function scatter(c: Column, vals: number[]): Column {
  let k = 0
  return c.map((x) => (x != null && Number.isFinite(x) ? vals[k++] : null))
}

export interface ReducerDef {
  arity: number // total args incl. the column
  fn: (vals: number[], ...args: number[]) => number
}
export interface VecDef {
  arity: number
  fn: (c: Column, ...args: number[]) => Column
}

export const REDUCERS: Record<string, ReducerDef> = {
  mean: { arity: 1, fn: (v) => mean(v) },
  std: { arity: 1, fn: (v) => std(v) },
  min: { arity: 1, fn: (v) => min(v) },
  max: { arity: 1, fn: (v) => max(v) },
  median: { arity: 1, fn: (v) => median(v) },
  total: { arity: 1, fn: (v) => total(v) },
  count: { arity: 1, fn: (v) => count(v) },
  quantile: { arity: 2, fn: (v, p) => quantile(v, p) },
}

export const VECFNS: Record<string, VecDef> = {
  zscore: {
    arity: 1,
    fn: (c) => {
      const p = present(c)
      const m = mean(p)
      const s = std(p)
      return c.map((x) => (x == null ? null : s === 0 ? 0 : (x - m) / s))
    },
  },
  minmax: {
    arity: 1,
    fn: (c) => {
      const p = present(c)
      const lo = min(p)
      const hi = max(p)
      return c.map((x) => (x == null ? null : hi === lo ? 0 : (x - lo) / (hi - lo)))
    },
  },
  percentile_rank: { arity: 1, fn: (c) => scatter(c, percentileRankAscending(present(c))) },
  rank: { arity: 1, fn: (c) => scatter(c, rankAscending(present(c))) },
  winsorize: {
    arity: 2,
    fn: (c, p) => {
      const v = present(c)
      const a = quantile(v, p)
      const b = quantile(v, 1 - p)
      const lo = Math.min(a, b) // guard against p>=0.5 inverting the bounds
      const hi = Math.max(a, b)
      return c.map((x) => (x == null ? null : Math.min(Math.max(x, lo), hi)))
    },
  },
  invert: {
    arity: 1,
    fn: (c) => {
      const v = present(c)
      const lo = min(v)
      const hi = max(v)
      return c.map((x) => (x == null ? null : lo + hi - x))
    },
  },
  clamp: {
    arity: 3,
    fn: (c, lo, hi) => c.map((x) => (x == null ? null : Math.min(Math.max(x, lo), hi))),
  },
  log: { arity: 1, fn: (c) => c.map((x) => (x == null ? null : x > 0 ? Math.log(x) : null)) },
  log10: { arity: 1, fn: (c) => c.map((x) => (x == null ? null : x > 0 ? Math.log10(x) : null)) },
  abs: { arity: 1, fn: (c) => c.map((x) => (x == null ? null : Math.abs(x))) },
  sqrt: { arity: 1, fn: (c) => c.map((x) => (x == null ? null : x >= 0 ? Math.sqrt(x) : null)) },
}

export const CONSTS: Record<string, number> = { pi: Math.PI, e: Math.E }

export const DOCS: FunctionDoc[] = [
  { name: 'mean', kind: 'reducer', arity: 1, signature: 'mean(col)', description: 'Среднее по непустым значениям' },
  { name: 'std', kind: 'reducer', arity: 1, signature: 'std(col)', description: 'Стандартное отклонение (популяционное)' },
  { name: 'min', kind: 'reducer', arity: 1, signature: 'min(col)', description: 'Минимум по непустым значениям' },
  { name: 'max', kind: 'reducer', arity: 1, signature: 'max(col)', description: 'Максимум по непустым значениям' },
  { name: 'median', kind: 'reducer', arity: 1, signature: 'median(col)', description: 'Медиана (линейная интерполяция)' },
  { name: 'total', kind: 'reducer', arity: 1, signature: 'total(col)', description: 'Сумма по непустым значениям' },
  { name: 'count', kind: 'reducer', arity: 1, signature: 'count(col)', description: 'Число непустых значений' },
  { name: 'quantile', kind: 'reducer', arity: 2, signature: 'quantile(col, p)', description: 'p-квантиль, p∈[0,1] (numpy/R-7)' },
  { name: 'zscore', kind: 'normalizer', arity: 1, signature: 'zscore(col)', description: '(x − mean)/std; нулевая дисперсия → 0' },
  { name: 'minmax', kind: 'normalizer', arity: 1, signature: 'minmax(col)', description: 'Линейно в [0,1]; min==max → 0' },
  { name: 'percentile_rank', kind: 'normalizer', arity: 1, signature: 'percentile_rank(col)', description: 'Перцентильный ранг в [0,1]' },
  { name: 'rank', kind: 'normalizer', arity: 1, signature: 'rank(col)', description: 'Ранг по возрастанию (1 = наименьший)' },
  { name: 'winsorize', kind: 'normalizer', arity: 2, signature: 'winsorize(col, p)', description: 'Обрезка хвостов к квантилям [p, 1−p]' },
  { name: 'invert', kind: 'normalizer', arity: 1, signature: 'invert(col)', description: 'Разворот полярности: (min+max) − x' },
  { name: 'clamp', kind: 'elementwise', arity: 3, signature: 'clamp(x, lo, hi)', description: 'Ограничить значения диапазоном [lo, hi]' },
  { name: 'log', kind: 'elementwise', arity: 1, signature: 'log(x)', description: 'Натуральный логарифм; x≤0 → нет данных' },
  { name: 'log10', kind: 'elementwise', arity: 1, signature: 'log10(x)', description: 'Десятичный логарифм; x≤0 → нет данных' },
  { name: 'abs', kind: 'elementwise', arity: 1, signature: 'abs(x)', description: 'Модуль' },
  { name: 'sqrt', kind: 'elementwise', arity: 1, signature: 'sqrt(x)', description: 'Корень; x<0 → нет данных' },
]
