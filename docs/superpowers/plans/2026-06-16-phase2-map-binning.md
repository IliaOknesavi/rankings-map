# Phase 2 — map binning & color scales (implementation plan)

> REQUIRED SUB-SKILL: superpowers TDD. Steps tracked with `- [ ]`.

**Goal:** Replace the continuous viridis choropleth with a **classed** map: bin values into K
classes (equal-interval or quantile), color from a sequential palette (diverging when the
formula is zero-centered), render a stepped legend. Add compact controls (method + class count).

**Architecture:** New pure module `src/scale.ts` (binning math, tested with vitest). `main.ts`
consumes it in `update()`/`drawLegend()`. Controls in `index.html`, stepped legend CSS in
`style.css`. Reuses `quantile` from `src/engine/stats` and color schemes from `d3-scale-chromatic`.

**Design basis:** approved 4-phase design + research (OECD/Datawrapper): quantile default,
5 classes, YlGnBu sequential / RdBu diverging, stepped legend, polarity-aware.

**Scope:** equal + quantile binning only (Jenks/ckmeans deferred). Continuous-gradient mode dropped
(stepped only). No URL state / country search (Phase 3).

---

## Task 1: `src/scale.ts` + tests
**Files:** Create `src/scale.ts`, `src/scale.test.ts`

API:
```ts
export type BinMethod = 'equal' | 'quantile'
export interface Bins { breaks: number[]; min: number; max: number; k: number } // breaks: k-1 ascending thresholds
export function computeBins(values: (number|null)[], method: BinMethod, k: number): Bins | null // null if <2 present
export function classOf(v: number, breaks: number[]): number   // count of breaks strictly below v -> 0..k-1
export function colorsFor(k: number, scheme: 'sequential'|'diverging'): string[] // length clamp(k,3,9)
```
- equal: `breaks[i] = min + (i+1)*(max-min)/k`, i=0..k-2
- quantile: `breaks[i] = quantile(present, (i+1)/k)`, i=0..k-2 (reuse engine/stats quantile)
- `classOf(v, breaks)`: `breaks.reduce((c,b)=> c + (v > b ? 1 : 0), 0)`
- `colorsFor`: `schemeYlGnBu[clamp(k,3,9)]` / `schemeRdBu[clamp(k,3,9)]` from d3-scale-chromatic

- [ ] Tests: equal breaks for [0..10] k=5 -> [2,4,6,8]; quantile breaks; classOf boundaries; <2 present -> null; all-equal column -> bins with min==max, classOf -> 0; colorsFor length.
- [ ] Implement; `npm test src/scale.test.ts` PASS. Commit.

## Task 2: wire into `main.ts`
**Files:** Modify `src/main.ts`

- Add module state: `let binMethod: BinMethod = 'quantile'`, `let classes = 5`.
- Track `centered` on formula mode: in `applyFormula`, `mode = {kind:'formula', label, higherBetter:true, centered: !!res.meta?.centered}` (extend the mode union).
- `update()`: compute `bins = computeBins(values, binMethod, classes)`. If null -> paint all present cells one mid color, else: `scheme = (mode.kind==='formula' && mode.centered) ? 'diverging' : 'sequential'`; `let colors = colorsFor(classes, scheme); const hb = mode.kind==='formula'? mode.higherBetter : mode.index.direction==='higherBetter'; if(!hb) colors = colors.slice().reverse();` then per country `colors[classOf(v, bins.breaks)]`, null -> `var(--no-data)`.
- `drawLegend()`: stepped — render `classes` swatches with boundary labels (min, breaks…, max). Replace the gradient-bar version.
- Wire new controls (Task 3) to re-`update()` on change.

- [ ] `npm run build` green; live: map shows discrete classes, legend stepped. Commit.

## Task 3: controls + legend styles
**Files:** Modify `index.html`, `src/style.css`

- `index.html`: a "Шкала" section with `<select id="binMethod">` (Квантили/Равные интервалы) and
  `<input id="classCount" type="number" min="3" max="9" value="5">`.
- `main.ts`: read these, listeners -> `update()`.
- `style.css`: `.legend-steps` (row of swatches), `.legend-step` swatch + tick labels.

- [ ] Live verify (quantile vs equal visibly differ; class count changes); build green. Commit.

## Task 4: adversarial review (workflow) + deploy
- [ ] Review lenses: binning math (equal/quantile breaks, classOf boundary correctness, <k distinct / all-equal / all-null), polarity & diverging selection, legend correctness, a11y/contrast.
- [ ] Fix confirmed findings (+tests). `npm test` + `npm run build` green. Push (auto-deploy).
