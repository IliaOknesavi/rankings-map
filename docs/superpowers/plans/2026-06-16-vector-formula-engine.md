# Vector formula engine — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the scalar `expr-eval` formula path with a standalone, column-vector formula engine (Desmos-style broadcasting) so `zscore(life_exp) * minmax(gdp_pc)` works and per-input normalization lives in the formula.

**Architecture:** A pure, DOM-free module `src/engine/` (lexer → parser → AST → tree-walk evaluator) with a stable public contract (`evaluate`, `parse`, `listFunctions`, versions). Two value types — `Scalar` and `Vec` (length-N column). Operators/functions broadcast element-wise; reducers collapse columns to scalars; all functions are null-aware. The app adapts `Dataset → EvalContext.columns` and calls the engine inside the existing Web Worker.

**Tech Stack:** TypeScript (strict, ES2020, bundler resolution), Vite, vitest (added in Task 0). No new runtime deps — the engine is hand-written (no mathjs/expr-eval).

**Spec:** `docs/superpowers/specs/2026-06-16-vector-formula-engine-design.md`

---

## File structure

```
src/engine/
  types.ts        # public: Column, EvalContext, EvalResult, EvalOptions, FunctionDoc; internal: Token, Node
  stats.ts        # null-aware numeric primitives (present, mean, std, quantile R-7, rank, percentileRank, …)
  lexer.ts        # tokenize(src) -> Token[]
  parser.ts       # parse(tokens) -> Node (Pratt); throws ParseError{message,pos}
  functions.ts    # FN catalog (reducers/normalizers/elementwise) + DOCS (FunctionDoc[])
  evaluate.ts     # evalNode(node, ctx) with broadcasting + null propagation
  index.ts        # public evaluate()/parse()/listFunctions() + ENGINE_VERSION/LANG_VERSION
  *.test.ts       # colocated vitest tests
docs/SCHEMA.md    # Dataset JSON schema + schemaVersion contract
```

Modified app files: `src/worker.ts` (thin transport), `src/main.ts` (drop normMode, wire engine, highlight pos), `src/types.ts` (drop NormMode/FormulaRequest/FormulaResponse), `index.html` (drop normalization `<select>`, update hint).

---

## Task 0: Test tooling + engine scaffold

**Files:**
- Modify: `package.json` (add devDep `vitest`, add `"test": "vitest run"`)
- Create: `src/engine/types.ts`, `src/engine/index.ts`, `src/engine/smoke.test.ts`

- [ ] **Step 1:** `npm i -D vitest@^4` and add `"test": "vitest run"` to `scripts`.
- [ ] **Step 2:** Create `src/engine/types.ts` with the public + internal types:

```ts
export type Column = (number | null)[]
export interface EvalContext { columns: Record<string, Column>; entityCount: number }
export interface EvalOptions { maxFormulaLength?: number; maxNodes?: number }
export interface EvalError { message: string; pos?: number }
export interface EvalResult { ok: boolean; values?: Column; error?: EvalError; meta?: { centered: boolean } }
export interface FunctionDoc {
  name: string
  kind: 'reducer' | 'normalizer' | 'elementwise'
  arity: number | [number, number]
  signature: string
  description: string
}
// internal AST
export type Tok =
  | { t: 'num'; v: number; pos: number }
  | { t: 'id'; v: string; pos: number }
  | { t: 'op'; v: string; pos: number }
  | { t: 'lp' | 'rp' | 'comma'; pos: number }
export type Node =
  | { k: 'num'; v: number; pos: number }
  | { k: 'id'; v: string; pos: number }
  | { k: 'unary'; op: string; x: Node; pos: number }
  | { k: 'binary'; op: string; a: Node; b: Node; pos: number }
  | { k: 'call'; name: string; args: Node[]; pos: number }
```

- [ ] **Step 3:** Create `src/engine/index.ts` skeleton exporting `ENGINE_VERSION='0.1.0'`, `LANG_VERSION=1`, and placeholder `evaluate/parse/listFunctions` (throwing `not implemented`) plus `export * from './types'`.
- [ ] **Step 4:** `src/engine/smoke.test.ts`: `expect(ENGINE_VERSION).toBe('0.1.0')`. Run `npm test` → PASS.
- [ ] **Step 5:** Commit `chore(engine): test tooling + scaffold`.

---

## Task 1: `stats.ts` — null-aware numeric primitives

**Files:** Create `src/engine/stats.ts`, `src/engine/stats.test.ts`

All reducers operate on **present** values only. `present(c) = c.filter(x => x != null && Number.isFinite(x))`.

- [ ] **Step 1 (tests first):** cover, with known values:
  - `present([1,null,3,NaN as any])` → `[1,3]`
  - `mean([1,2,3])`=2; `std([2,4,4,4,5,5,7,9])`=2 (population); `median([1,2,3,4])`=2.5
  - `quantile([1,2,3,4],0.5)`=2.5; `quantile([1,2,3,4],0.25)`=1.75 (R-7 linear); `quantile([10,20,30],0)`=10, `…,1)`=30
  - `min`,`max`,`total`,`count` basics
  - `rankAscending([30,10,20])` → ranks `[3,1,2]`; ties average: `rankAscending([10,10,20])` → `[1.5,1.5,3]`
  - empty-input reducers → `NaN`

- [ ] **Step 2:** Implement. Key algorithm — quantile R-7 (numpy `linear`):

```ts
export function quantile(vals: number[], p: number): number {
  if (vals.length === 0) return NaN
  const s = [...vals].sort((a, b) => a - b)
  if (p <= 0) return s[0]
  if (p >= 1) return s[s.length - 1]
  const h = (s.length - 1) * p
  const lo = Math.floor(h)
  return s[lo] + (h - lo) * (s[lo + 1] - s[lo])
}
```

`std` = population: `sqrt(mean((x-mean)^2))`. `rankAscending(vals)` returns a rank per **present** position with ties averaged (sort indices, assign average rank to equal-value groups). Provide a `percentileRankAscending(vals)` returning `(rank-1)/(n-1)` in `[0,1]` (n==1 → 0.5).

- [ ] **Step 3:** Run `npm test src/engine/stats.test.ts` → PASS.
- [ ] **Step 4:** Commit `feat(engine): null-aware stats primitives`.

---

## Task 2: `lexer.ts` — tokenizer

**Files:** Create `src/engine/lexer.ts`, `src/engine/lexer.test.ts`

Tokens: numbers (`\d+(\.\d+)?` incl leading `.`), identifiers (`[A-Za-z_][A-Za-z0-9_]*`), operators (`+ - * / ^` and two-char `<= >= == !=` then `< >`), `(` `)` `,`. Whitespace skipped. Each token carries `pos` (start offset). Unknown char → throw `{message:"Неизвестный символ '<c>'", pos}`.

- [ ] **Step 1 (tests):** `tokenize('a*2')` → ids/num/op with positions; `tokenize('zscore(x) <= 0.5')` recognizes `<=` as one op; unknown char `@` throws with correct pos.
- [ ] **Step 2:** Implement a single-pass scanner. Match two-char operators before single-char.
- [ ] **Step 3:** `npm test src/engine/lexer.test.ts` → PASS.
- [ ] **Step 4:** Commit `feat(engine): lexer`.

---

## Task 3: `parser.ts` — Pratt parser → AST

**Files:** Create `src/engine/parser.ts`, `src/engine/parser.test.ts`

Precedence (low→high): comparisons `< <= > >= == !=` ‹ `+ -` ‹ `* /` ‹ unary `-` ‹ `^` (right-assoc). Grammar: primary = number | ident | `name(args)` | `(expr)`. Calls: `id` followed by `(` → `call`. `parse` throws `ParseError{message,pos}` on unexpected token / unbalanced parens / trailing input. Counts nodes; caller enforces `maxNodes`.

- [ ] **Step 1 (tests):**
  - `parse(tokenize('a + b * c'))` → `binary(+ , a, binary(*, b, c))`
  - `^` right-assoc: `2^3^2` → `2^(3^2)`
  - unary: `-a^2` → `-(a^2)` (unary binds looser than `^`, tighter than `*`) — assert structure
  - `zscore(x)` → `call zscore [id x]`; `quantile(c, 0.9)` → two args
  - errors: `a +` → ParseError at end; `f(a,)` → ParseError; `(a` → unbalanced; `a b` → trailing token, each with `pos`
- [ ] **Step 2:** Implement precedence-climbing. Map binary op → precedence; `^` right-assoc; unary `-` as prefix. Build `Node` with `pos`.
- [ ] **Step 3:** `npm test src/engine/parser.test.ts` → PASS.
- [ ] **Step 4:** Commit `feat(engine): pratt parser`.

---

## Task 4: `functions.ts` — function catalog + docs

**Files:** Create `src/engine/functions.ts`, `src/engine/functions.test.ts`

Two maps keyed by name:
- `REDUCERS: Record<string, (c: number[]) => number>` (input already `present`-filtered by caller): `mean,std,min,max,median,total,count` and `quantile` (2-arg: `(c, p)`).
- `VECFNS: Record<string, (c: Column, ...args:number[]) => Column>` null-aware, position-preserving: `zscore,minmax,percentile_rank,rank,winsorize(c,p),invert,clamp(x,lo,hi),log,log10,abs,sqrt`.
- `CONSTS: { pi: Math.PI, e: Math.E }`.
- `DOCS: FunctionDoc[]` covering every name (used by `listFunctions`).

Edge cases (assert in tests): `zscore` std==0 → present cells `0`; `minmax` max==min → present cells `0`; `percentile_rank` n==1 → `0.5`; `log(≤0)`/`log10(≤0)`/`sqrt(<0)` → `null`; `null` stays `null` everywhere; `winsorize(c,p)` clamps to `[quantile(present,p), quantile(present,1-p)]`; `invert` = `(min+max) - x` over present.

- [ ] **Step 1 (tests):** one assertion block per function, incl. the edge cases above and null-preservation.
- [ ] **Step 2:** Implement using `stats.ts`. Example:

```ts
import { present, mean, std, quantile } from './stats'
export const VECFNS = {
  zscore: (c: Column) => { const p = present(c), m = mean(p), s = std(p)
    return c.map(x => x == null ? null : (s === 0 ? 0 : (x - m) / s)) },
  minmax: (c: Column) => { const p = present(c), lo = Math.min(...p), hi = Math.max(...p)
    return c.map(x => x == null ? null : (hi === lo ? 0 : (x - lo) / (hi - lo))) },
  // … percentile_rank, rank, winsorize, invert, clamp, log, log10, abs, sqrt
} as const
```

- [ ] **Step 3:** `npm test src/engine/functions.test.ts` → PASS.
- [ ] **Step 4:** Commit `feat(engine): function catalog + docs`.

---

## Task 5: `evaluate.ts` — tree-walk evaluator with broadcasting

**Files:** Create `src/engine/evaluate.ts`, `src/engine/evaluate.test.ts`

`evalNode(node, ctx): number | Column`. Rules:
- `num` → number; `id` → constant (pi/e) or `ctx.columns[name]` (Vec); unknown id → throw `{message:"Неизвестная переменная: <id>", pos}`.
- `unary -` → negate (scalar or element-wise; null stays null).
- `binary` (`+ - * / ^` and comparisons): apply `broadcast(a,b,op)`:
  - both scalar → scalar op; scalar/vec or vec/scalar → map; vec/vec → element-wise (lengths must match `entityCount`).
  - if either element is `null` → result element `null`. Non-finite result → `null` (for vec) / leave for scalar but normalized at top level.
  - comparisons return `1`/`0`.
- `call`: if name in `REDUCERS` → evaluate arg to Vec, `present()`-filter, return scalar (quantile takes 2nd scalar arg `p`); if in `VECFNS` → evaluate arg(s), return Vec; else throw `{message:"Неизвестная функция: <name>", pos}`. Arg-count mismatch → throw with `pos`.

- [ ] **Step 1 (tests):** scalar∘scalar; scalar∘vec; vec∘vec; precedence end-to-end; null propagation (`[1,null]+[1,1]` → `[2,null]`); `mean([..])` inside `[..]*0+mean` broadcasts; division by zero → null cell; **headline**: `zscore(life_exp)*minmax(gdp_pc)` over a 4-country fixture returns expected vector; unknown id/function throw with pos.
- [ ] **Step 2:** Implement `broadcast` + `evalNode`. Helper `asVec(x, n)` lifts scalar→length-n. Sanitize each output cell: `Number.isFinite(v) ? v : null`.
- [ ] **Step 3:** `npm test src/engine/evaluate.test.ts` → PASS.
- [ ] **Step 4:** Commit `feat(engine): evaluator with broadcasting`.

---

## Task 6: `index.ts` — public API

**Files:** Modify `src/engine/index.ts`, create `src/engine/index.test.ts`

Implement:
- `parse(formula)`: lex+parse, return `{ok:true}` or `{ok:false,error:{message,pos}}` (catch lexer/parser throws).
- `evaluate(formula, ctx, opts)`:
  - trim; empty → `{ok:false,error:{message:'Пустая формула'}}`.
  - length > `opts.maxFormulaLength ?? 1000` → error.
  - lex+parse (catch → error); node count > `opts.maxNodes ?? 500` → error.
  - eval (catch eval throws → error); lift scalar result to length-N vec; sanitize non-finite → null.
  - `meta.centered`: over present output values, `centered = Math.abs(mean) < 1e-6 || Math.abs(mean) < 0.05 * std`.
  - return `{ok:true, values, meta}`.
- `listFunctions()` → `DOCS`.

- [ ] **Step 1 (tests):** end-to-end headline case via `evaluate`; bare `gdp_pc` returns its column unchanged; empty/too-long/unknown-id errors; `meta.centered` true for `zscore(x)`, false for `minmax(x)`; `parse('a+')` → `{ok:false,pos}`.
- [ ] **Step 2:** Implement.
- [ ] **Step 3:** `npm test` (full) → PASS.
- [ ] **Step 4:** Commit `feat(engine): public api (evaluate/parse/listFunctions)`.

---

## Task 7: Worker integration

**Files:** Modify `src/worker.ts`

Replace the expr-eval logic with a thin transport:

```ts
import { evaluate } from './engine'
import type { EvalContext, EvalResult } from './engine/types'
type Req = { formula: string } & EvalContext
self.onmessage = (e: MessageEvent<Req>) => {
  const { formula, columns, entityCount } = e.data
  const res: EvalResult = evaluate(formula, { columns, entityCount })
  ;(self as DedicatedWorkerGlobalScope).postMessage(res)
}
```

- [ ] **Step 1:** Rewrite `worker.ts` as above. Delete the old `normalize()`/normMode code.
- [ ] **Step 2:** `npm run build` (tsc) → no type errors in worker.
- [ ] **Step 3:** Commit `refactor(worker): use the vector engine`.

---

## Task 8: App wiring — `main.ts`, `types.ts`, `index.html`

**Files:** Modify `src/main.ts`, `src/types.ts`, `index.html`

- [ ] **Step 1:** `src/types.ts`: delete `NormMode`, `FormulaRequest`, `FormulaResponse`.
- [ ] **Step 2:** `index.html`: remove the `<select id="normSelect">` field and its label; update the formula hint to list a few functions (`zscore, minmax, percentile_rank, quantile, rank, log`). Keep `formulaInput`, `applyFormula`, `clearFormula`, `formulaError`.
- [ ] **Step 3:** `src/main.ts`:
  - remove `normSelect` handle + listener; remove `NormMode` import.
  - `runFormula` posts `{ formula, columns, entityCount }` and resolves `EvalResult` (import types from `./engine/types`).
  - in `applyFormula`: build `columns` for current year (as today), call worker, on `res.error` set `formulaError.textContent = res.error.message` (and optionally mark the formula box invalid); on success set `formulaValues = res.values`, `mode = {kind:'formula', label, higherBetter: !(res.meta?.centered) ? true : true}` (keep current `higherBetter:true`; centered hint reserved for later binning work — do not change color logic in this task).
- [ ] **Step 4:** `npm run build` → green; manual: `npm run dev`, enter `zscore(life_exp)*minmax(gdp_pc)`, map renders, bad formula shows the error.
- [ ] **Step 5:** Commit `feat(app): per-input normalization via the formula engine`.

---

## Task 9: `docs/SCHEMA.md`

**Files:** Create `docs/SCHEMA.md`

Document the `Dataset` JSON (`schemaVersion`, `entities`, `years`, `indices[].{id,label,unit,direction,source,license,url}`, `series[indexId][entityId][]`, `geoIdToEntity`) as the stable data contract, and the engine `EvalContext` adapter (columns = `series[id]` mapped over `entities` for a chosen year).

- [ ] **Step 1:** Write `docs/SCHEMA.md`.
- [ ] **Step 2:** Commit `docs: dataset schema contract`.

---

## Task 10: Final verification

- [ ] **Step 1:** `npm test` → all engine tests green.
- [ ] **Step 2:** `npm run build` → tsc + vite build clean.
- [ ] **Step 3:** Adversarial review (parallel agents): quantile/stats math correctness, null/edge handling, parser/security, spec coverage. Fix confirmed issues.
- [ ] **Step 4:** Commit any fixes; push `main` (auto-deploy).

---

## Self-review notes (author)
- Spec §3 contract → Tasks 0,6. §4 semantics → Tasks 1,4,5. §5 parser → Tasks 2,3. §6 safety → Tasks 5,6. §7 integration → Tasks 7,8,9. §9 testing → every task. §10 out-of-scope respected (no UI redesign/binning/UDF here).
- `meta.centered` defined identically in spec §3 and Task 6 (mean-based). `higherBetter` color logic intentionally unchanged (deferred to binning iteration).
- Names consistent: `EvalContext.columns/entityCount`, `EvalResult.{ok,values,error,meta}`, `percentile_rank` (formula name) vs `percentileRankAscending` (stats helper).
