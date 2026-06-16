# Vector formula engine — design

- **Date:** 2026-06-16
- **Status:** approved (design)
- **Scope of this spec:** the formula engine only. UI redesign, color binning, sliders/multi-row
  editor, user-defined functions (`f(x)=…`), npm publication, and any backend are **out of scope**
  (later iterations).

## 1. Context & goal

`rankings-map` lets the user compose a country index from data columns and paints it as a choropleth.
Today the formula engine (`src/worker.ts`, `expr-eval`) is **scalar per country** and normalization is a
single global dropdown (`none | zscore | minmax`) applied to every column before evaluation.

We want per-input normalization expressed *inside the formula*, e.g.:

```
zscore(life_exp) * minmax(gdp_pc)
```

The cleanest way to get this is to make the engine **column-vector aware** with Desmos-style
broadcasting: a country column is a length-`N` list, operators and functions broadcast element-wise,
and a small set of reducers collapse a column to a scalar. Then per-input normalization is *emergent*
— a normal expression — and the global normalization dropdown disappears.

The engine is built as a **standalone, framework-agnostic module** with a stable, documented contract
so it can later be extracted to a package or wrapped by an HTTP API **without rewrites**. No backend or
publication now — only clean boundaries.

## 2. Module boundary

New self-contained module `src/engine/` — pure TypeScript, **no imports from the app and no DOM access**.
It is the single source of truth for the formula language.

```
src/engine/
  index.ts        # public API + ENGINE_VERSION + LANG_VERSION; re-exports public types
  types.ts        # Column, EvalContext, EvalResult, EvalOptions, FunctionDoc (public) + AST types (internal)
  lexer.ts        # source string -> tokens
  parser.ts       # tokens -> AST (Pratt / precedence-climbing)
  evaluate.ts     # AST -> value, with broadcasting
  functions.ts    # function catalog (reducers / normalizers / element-wise) + FunctionDoc list
  stats.ts        # null-aware numeric primitives (present, mean, std, quantile, rank, …)
  *.test.ts       # vitest unit tests
```

The app keeps its own `Dataset` type and adapts `Dataset → EvalContext.columns`; the engine never
depends on the data-file format. The `Dataset` schema is documented in `docs/SCHEMA.md` and carries
`schemaVersion` (currently `1`) as the data contract.

## 3. Public contract (stable)

```ts
// A data column aligned to the entity list; null = missing for that country.
export type Column = (number | null)[]

export interface EvalContext {
  columns: Record<string, Column> // index id -> column, every column length === entityCount
  entityCount: number             // N (e.g. 217)
}

export interface EvalOptions {
  maxFormulaLength?: number       // default 1000
  maxNodes?: number               // AST node cap, default 500
}

export interface EvalResult {
  ok: boolean
  values?: Column                 // length N; null where the result is missing/undefined
  error?: { message: string; pos?: number } // pos = char offset of the offending token (for UI highlight)
  meta?: { centered: boolean }    // true when the result's present values are ≈ zero-centered
                                  // (|mean| < 1e-6, or |mean| < 0.05·std) — computed from the OUTPUT,
                                  // not the AST. A hint for choosing a diverging color scale later.
}

export interface FunctionDoc {
  name: string
  kind: 'reducer' | 'normalizer' | 'elementwise'
  arity: number | [min: number, max: number]
  signature: string               // e.g. "quantile(col, p)"
  description: string
}

export const ENGINE_VERSION: string // module version
export const LANG_VERSION: number   // formula-language version (bump on breaking language changes)

export function evaluate(formula: string, ctx: EvalContext, opts?: EvalOptions): EvalResult
export function parse(formula: string): { ok: boolean; error?: { message: string; pos?: number } }
export function listFunctions(): FunctionDoc[]
```

`evaluate` never throws for user-input errors — it returns `{ ok: false, error }`. It throws only on
programmer misuse (e.g. mismatched column lengths in `ctx`).

## 4. Value model & semantics

Two internal value types: `Scalar` (`number`) and `Vec` (`Column`, length `N`).

### Broadcasting (Desmos-style)
Binary operators `+ - * / ^` and comparisons `< <= > >= == !=`:
- scalar ∘ scalar → scalar
- scalar ∘ vec, vec ∘ scalar → vec (apply element-wise)
- vec ∘ vec → vec (element-wise; both must be length `N`)

So `zscore(life_exp) * minmax(gdp_pc)` multiplies two length-`N` vecs element-wise. `*` is **element-wise**,
never a dot product.

Comparisons yield `1` / `0` (numeric), null-aware. Unary `-` negates. `^` is right-associative.

Precedence (high → low): `^` › unary `-` › `* /` › `+ -` › comparisons.

Constants: numeric literals; `pi`, `e`.

### Null / missing propagation
- **Element-wise** (operators, element-wise functions): if either operand is `null` at index *i*, the
  result at *i* is `null`. The country renders as "no data".
- **Reducers** compute over **present** values only (drop `null`/`NaN`), then return a scalar.
- Any non-finite intermediate (`NaN`, `±Infinity`) at an output cell becomes `null`.

### Reducers (Vec → Scalar; over present values)
| Name | Meaning |
|---|---|
| `mean(c)` | arithmetic mean of present values |
| `std(c)` | **population** standard deviation (÷N) of present values |
| `min(c)`, `max(c)` | min / max of present values |
| `median(c)` | median (linear interpolation) of present values |
| `quantile(c, p)` | p-quantile, `p ∈ [0,1]`, **linear interpolation (numpy/R-7 method)** |
| `total(c)` | sum of present values |
| `count(c)` | number of present values |

If a reducer has zero present values, it returns `NaN` (→ downstream cells become `null`).

### Normalizers & element-wise functions (Vec → Vec; null-aware, position-preserving)
| Name | Meaning | Edge case |
|---|---|---|
| `zscore(c)` | `(x − mean) / std` over present | `std == 0` → present cells `0` |
| `minmax(c)` | `(x − min) / (max − min)` over present | `max == min` → present cells `0` |
| `percentile_rank(c)` | ascending rank fraction in `[0,1]`; ties get the average rank | `count == 1` → `0.5` |
| `rank(c)` | 1-based ascending rank (1 = smallest); ties average | — |
| `winsorize(c, p)` | clamp present values to `[quantile(c,p), quantile(c,1−p)]`, `p ∈ [0,0.5)` | — |
| `invert(c)` | range-reflect: `(min + max) − x` over present (flip polarity, keep scale) | — |
| `clamp(x, lo, hi)` | element-wise `min(max(x,lo),hi)`; `x` vec or scalar, `lo/hi` scalars | — |
| `log(c)` | natural log, element-wise | `x ≤ 0` → `null` |
| `log10(c)` | base-10 log, element-wise | `x ≤ 0` → `null` |
| `abs(c)`, `sqrt(c)` | element-wise | `sqrt(x<0)` → `null` |

For normalized **polarity** (lower-is-better indicators) the idiomatic forms are `invert(c)` (raw scale)
or `1 - minmax(c)` / `1 - percentile_rank(c)` (normalized scale). The recommended UI default
normalization (percentile-rank) is a later-iteration UI concern; the engine only provides the functions.

`null` always stays `null` through every function above.

## 5. Parser & evaluator

- **Lexer** → tokens (number, identifier, operator, paren, comma) with char offsets.
- **Parser** → AST via precedence climbing. AST node kinds: `Num`, `Const`, `Ident`, `Unary`, `Binary`,
  `Call`. No statements, no assignment (UDFs are a later iteration).
- **Evaluator** walks the AST against `EvalContext`:
  - `Ident` resolves to a column (`Vec`) from `ctx.columns`; unknown identifier → error with `pos`.
  - `Call` resolves to a function in the catalog; unknown function or wrong arity → error with `pos`.
  - operators apply broadcasting rules above.
- **No `eval` / `new Function`.** Only the AST is interpreted; only known identifiers and catalog
  functions are reachable. There is no member access, no property lookup, no prototype access.

## 6. Safety & limits

- `maxFormulaLength` (default 1000): reject longer input pre-parse.
- `maxNodes` (default 500): reject ASTs with too many nodes (guards pathological nesting).
- The engine is pure and synchronous; on 217-length vectors it is sub-millisecond. It still runs inside
  the existing **Web Worker** with a host-side **timeout + `terminate()` watchdog** (e.g. 3 s) as
  belt-and-suspenders and to keep the seam ready for future UDFs.

## 7. Integration with the app

- `src/worker.ts` becomes a thin transport: receive `{ formula, columns, entityCount }`, call
  `engine.evaluate`, post back `EvalResult`. The old `normalize()` and per-column normMode logic is removed.
- `src/main.ts`:
  - build `columns` for the current year (as today) and call the engine; drop `normMode`.
  - on `error`, show the message and use `error.pos` to highlight the offending token in the formula box.
  - "pick a ready index" path is unchanged (direct column lookup, no engine needed).
- `src/types.ts`: remove `NormMode`, `FormulaRequest`, and `FormulaResponse`. The worker message is
  `{ formula: string } & EvalContext` in, `EvalResult` out — both imported from `src/engine`.
- `index.html`: remove the normalization `<select>` and its hint; update the formula hint to mention the
  new functions. The "Сбросить к индексу" / formula box otherwise stay.
- `docs/SCHEMA.md`: document the `Dataset` JSON schema + `schemaVersion` as the data contract.

## 8. Error handling

| Situation | Result |
|---|---|
| empty formula | `{ ok:false, error:{ message:"Пустая формула" } }` |
| syntax error | `{ ok:false, error:{ message, pos } }` (pos at the bad token) |
| unknown identifier | `{ ok:false, error:{ message:"Неизвестная переменная: X", pos } }` |
| unknown function / bad arity | `{ ok:false, error:{ message, pos } }` |
| over length/node caps | `{ ok:false, error:{ message } }` |
| result is a scalar, not a vec | broadcast scalar to length-`N` vec (a constant map is valid) |
| reducer over empty column | `NaN` → cells `null` (map shows no data), `ok:true` |

## 9. Testing (TDD, vitest)

Engine is pure → tested directly, no worker. Cases:
- broadcasting: scalar∘scalar, scalar∘vec, vec∘scalar, vec∘vec; precedence and `^` right-assoc.
- null propagation: element-wise null in → null out; reducers ignore null; non-finite → null.
- each reducer (`mean/std/min/max/median/quantile/total/count`) incl. empty-column → NaN.
- each function (`zscore/minmax/percentile_rank/rank/winsorize/invert/clamp/log/log10/abs/sqrt`) incl.
  documented edge cases (`std==0`, `max==min`, `count==1`, `log(≤0)`, `sqrt(<0)`).
- `quantile` numeric correctness against known R-7 values.
- parser errors return correct `pos`; unknown ident/function; arity errors; length/node caps.
- headline case: `zscore(life_exp) * minmax(gdp_pc)` over a small fixture.
- equivalence: a bare column id (`gdp_pc`) returns that column unchanged.
- `meta.centered` is true for a top-level zscore-based result, false for minmax/raw.

## 10. Out of scope (future iterations)

UI redesign & progressive disclosure; color-scale & quantile binning; weight sliders / multi-row
expression editor; user-defined functions `f(x)=…`; npm publication; HTTP/serverless API. The contract
in §3 and the `engine/` boundary are designed so these can be added without breaking changes.
