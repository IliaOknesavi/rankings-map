import { geoNaturalEarth1, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Dataset, IndexMeta } from './types'
import type { EvalResult } from './engine/types'
import { computeBins, classOf, colorsFor, type BinMethod, type Bins } from './scale'
import { PRESETS } from './presets'
import { encodeState, decodeState, type AppState } from './urlstate'

const W = 960
const H = 500
const SVGNS = 'http://www.w3.org/2000/svg'
const baseUrl = import.meta.env.BASE_URL

const $ = (id: string) => document.getElementById(id) as HTMLElement
const svg = $('map') as unknown as SVGSVGElement
const indexSelect = $('indexSelect') as HTMLSelectElement
const yearSlider = $('yearSlider') as HTMLInputElement
const yearLabel = $('yearLabel')
const binMethodSel = $('binMethod') as HTMLSelectElement
const classCountInput = $('classCount') as HTMLInputElement
const formulaInput = $('formulaInput') as HTMLTextAreaElement
const applyBtn = $('applyFormula') as HTMLButtonElement
const formulaError = $('formulaError')
const legend = $('legend')
const statusEl = $('status')
const sourceNote = $('sourceNote')
const tooltip = $('tooltip')
const presetsEl = $('presets')
const builderEl = $('builder')
const addRowBtn = $('addRow') as HTMLButtonElement
const searchInput = $('search') as HTMLInputElement
const searchResults = $('searchResults')
const themeBtn = $('themeBtn') as HTMLButtonElement
const shareBtn = $('shareBtn') as HTMLButtonElement
const modeSeg = $('modeSeg')
const panelIndex = $('panel-index')
const panelFormula = $('panel-formula')

// ---- formula worker (seq-matched so slider drags don't race) ----
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
let evalSeq = 0
const waiters = new Map<number, (r: EvalResult) => void>()
worker.onmessage = (e: MessageEvent<{ seq: number; res: EvalResult }>) => {
  const cb = waiters.get(e.data.seq)
  if (cb) {
    waiters.delete(e.data.seq)
    cb(e.data.res)
  }
}
function runFormula(formula: string): Promise<{ seq: number; res: EvalResult }> {
  const seq = ++evalSeq
  const columns = columnsForYear(currentYearIndex())
  return new Promise((resolve) => {
    waiters.set(seq, (res) => resolve({ seq, res }))
    worker.postMessage({ seq, formula, columns, entityCount: data.entities.length })
  })
}

interface PathEntry {
  el: SVGPathElement
  entityId: string | null
}
interface BRow {
  index: string
  norm: 'percentile_rank' | 'zscore' | 'minmax' | 'raw'
  weight: number
  invert: boolean
}

let data: Dataset
let entityIndexById: Map<string, number>
let paths: PathEntry[] = []
let formulaValues: (number | null)[] | null = null
let formulaCentered = false
let builderRows: BRow[] = []
let foundEntityId: string | null = null

const state: AppState = {
  mode: 'index', index: '', formula: '', year: 0, binMethod: 'quantile', classes: 5, theme: 'dark',
}

// ---------------------------------------------------------------- boot
async function boot() {
  statusEl.textContent = 'Загрузка данных…'
  const [ds, topo] = await Promise.all([
    fetch(`${baseUrl}data/dataset.json`).then((r) => r.json() as Promise<Dataset>),
    fetch(`${baseUrl}data/world-110m.json`).then((r) => r.json()),
  ])
  data = ds
  entityIndexById = new Map(ds.entities.map((e, i) => [e.id, i]))

  // defaults, then overlay shared URL state
  const fallback: AppState = {
    mode: 'index',
    index: ds.indices[0].id,
    formula: 'percentile_rank(gdp_pc)',
    year: ds.years[ds.years.length - 1],
    binMethod: 'quantile',
    classes: 5,
    theme: 'dark',
  }
  Object.assign(state, decodeState(location.hash, fallback))
  // reconcile shared state against the actual dataset (a stale/bogus id must not crash render)
  if (!data.indices.some((i) => i.id === state.index)) state.index = data.indices[0].id

  buildStaticControls()
  applyTheme()
  renderGeometry(topo)

  if (state.mode === 'formula') {
    setMode('formula', false)
    formulaInput.value = state.formula
    await applyFormulaText(state.formula, false)
  } else {
    setMode('index', false)
    render()
  }
  statusEl.textContent = `${ds.entities.length} стран · ${ds.years.length} лет · ${ds.indices.length} индекса`
}

// ---------------------------------------------------------------- controls
function buildStaticControls() {
  for (const idx of data.indices) {
    const o = document.createElement('option')
    o.value = idx.id
    o.textContent = idx.label
    indexSelect.appendChild(o)
  }
  indexSelect.value = state.index

  yearSlider.min = '0'
  yearSlider.max = String(data.years.length - 1)
  yearSlider.value = String(Math.max(0, data.years.indexOf(state.year)))
  state.year = data.years[Number(yearSlider.value)] // reconcile a bogus/out-of-range year from the URL

  binMethodSel.value = state.binMethod
  classCountInput.value = String(state.classes)
  $('varList').textContent = data.indices.map((i) => i.id).join(', ')

  for (const p of PRESETS) {
    const b = document.createElement('button')
    b.className = 'chip'
    b.textContent = p.name
    b.addEventListener('click', () => {
      formulaInput.value = p.formula
      void applyFormulaText(p.formula, true)
    })
    presetsEl.appendChild(b)
  }

  modeSeg.querySelectorAll('button').forEach((b) =>
    b.addEventListener('click', () => setMode((b as HTMLElement).dataset.mode as AppState['mode'], true)),
  )
  modeSeg.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      setMode(state.mode === 'index' ? 'formula' : 'index', true)
      ;(modeSeg.querySelector('button.on') as HTMLElement | null)?.focus()
      e.preventDefault()
    }
  })
  indexSelect.addEventListener('change', () => {
    state.index = indexSelect.value
    render()
    syncUrl()
  })
  yearSlider.addEventListener('input', () => {
    state.year = data.years[currentYearIndex()]
    if (state.mode === 'formula') void recomputeForYear()
    else render()
    syncUrl()
  })
  binMethodSel.addEventListener('change', () => {
    state.binMethod = binMethodSel.value as BinMethod
    render()
    syncUrl()
  })
  classCountInput.addEventListener('change', () => {
    state.classes = Math.max(3, Math.min(9, Number(classCountInput.value) || 5))
    classCountInput.value = String(state.classes)
    render()
    syncUrl()
  })
  applyBtn.addEventListener('click', () => void applyFormulaText(formulaInput.value, true))
  addRowBtn.addEventListener('click', () => {
    builderRows.push(defaultRow())
    renderBuilder()
    void applyBuilder()
  })
  themeBtn.addEventListener('click', () => {
    state.theme = state.theme === 'dark' ? 'light' : 'dark'
    applyTheme()
    syncUrl()
  })
  shareBtn.addEventListener('click', () => void share())
  setupSearch()
}

function setMode(mode: AppState['mode'], user: boolean) {
  state.mode = mode
  modeSeg.querySelectorAll('button').forEach((b) => {
    const on = (b as HTMLElement).dataset.mode === mode
    b.classList.toggle('on', on)
    b.setAttribute('aria-pressed', String(on))
  })
  panelIndex.hidden = mode !== 'index'
  panelFormula.hidden = mode !== 'formula'
  if (mode === 'formula') {
    if (builderRows.length === 0) builderRows = [defaultRow()]
    renderBuilder()
    if (user) void applyBuilder()
  } else if (user) {
    state.index = indexSelect.value || data.indices[0].id
    render()
  }
  if (user) syncUrl()
}

// ---------------------------------------------------------------- composite builder
function defaultRow(): BRow {
  const idx = data.indices[Math.min(builderRows.length, data.indices.length - 1)]
  return { index: idx.id, norm: 'percentile_rank', weight: 1, invert: idx.direction === 'lowerBetter' }
}

function renderBuilder() {
  builderEl.innerHTML = ''
  builderRows.forEach((row, i) => {
    const el = document.createElement('div')
    el.className = 'brow'
    const idxOpts = data.indices
      .map((idx) => `<option value="${esc(idx.id)}"${idx.id === row.index ? ' selected' : ''}>${esc(idx.label)}</option>`)
      .join('')
    const normOpts = (
      [
        ['percentile_rank', 'перцентиль'],
        ['zscore', 'z-score'],
        ['minmax', 'min-max'],
        ['raw', 'сырое'],
      ] as const
    )
      .map(([v, t]) => `<option value="${v}"${v === row.norm ? ' selected' : ''}>${t}</option>`)
      .join('')
    el.innerHTML =
      `<select class="b-idx">${idxOpts}</select>` +
      `<select class="b-norm">${normOpts}</select>` +
      `<button class="rm" title="Убрать">×</button>` +
      `<div class="wt"><input type="checkbox" class="b-inv"${row.invert ? ' checked' : ''} title="инвертировать (меньше = лучше)"/>` +
      `<input type="range" class="b-wt" min="0" max="1" step="0.05" value="${row.weight}"/>` +
      `<span class="wv">${row.weight.toFixed(2)}</span></div>`
    el.querySelector('.b-idx')!.addEventListener('change', (e) => {
      row.index = (e.target as HTMLSelectElement).value
      void applyBuilder()
    })
    el.querySelector('.b-norm')!.addEventListener('change', (e) => {
      row.norm = (e.target as HTMLSelectElement).value as BRow['norm']
      void applyBuilder()
    })
    el.querySelector('.b-inv')!.addEventListener('change', (e) => {
      row.invert = (e.target as HTMLInputElement).checked
      void applyBuilder()
    })
    const wt = el.querySelector('.b-wt') as HTMLInputElement
    const wv = el.querySelector('.wv') as HTMLElement
    wt.addEventListener('input', () => {
      row.weight = Number(wt.value)
      wv.textContent = row.weight.toFixed(2)
      void applyBuilder()
    })
    el.querySelector('.rm')!.addEventListener('click', () => {
      builderRows.splice(i, 1)
      if (builderRows.length === 0) builderRows = [defaultRow()]
      renderBuilder()
      void applyBuilder()
    })
    builderEl.appendChild(el)
  })
}

function composeBuilder(): string {
  const terms = builderRows
    .filter((r) => r.weight > 0)
    .map((r) => {
      let e = r.norm === 'raw' ? r.index : `${r.norm}(${r.index})`
      if (r.invert) {
        if (r.norm === 'raw') e = `invert(${r.index})`
        else if (r.norm === 'zscore') e = `(-1 * zscore(${r.index}))`
        else e = `(1 - ${r.norm}(${r.index}))`
      }
      return r.weight === 1 ? e : `${r.weight} * ${e}`
    })
  return terms.length ? terms.join(' + ') : '0'
}

async function applyBuilder() {
  const formula = composeBuilder()
  formulaInput.value = formula
  await applyFormulaText(formula, true)
}

// ---------------------------------------------------------------- formula eval
async function applyFormulaText(raw: string, sync: boolean): Promise<void> {
  formulaError.textContent = ''
  const trimmed = raw.trim()
  if (!trimmed) {
    formulaError.textContent = 'Введите формулу'
    return
  }
  // record intent synchronously so a concurrent year-drag re-evaluates THIS formula, not the old one
  state.mode = 'formula'
  state.formula = raw
  const formula = trimmed.replace(/^\s*[A-Za-z_]\w*\s*=(?!=)\s*/, '')
  const { seq, res } = await runFormula(formula)
  if (seq !== evalSeq) return // superseded by a newer eval
  if (!res.ok || !res.values) {
    formulaError.textContent = res.error?.message ?? 'Ошибка вычисления'
    return
  }
  formulaValues = res.values
  formulaCentered = !!res.meta?.centered
  render()
  if (sync) syncUrl()
}

async function recomputeForYear(): Promise<void> {
  formulaError.textContent = ''
  const { seq, res } = await runFormula(state.formula.replace(/^\s*[A-Za-z_]\w*\s*=(?!=)\s*/, ''))
  if (seq !== evalSeq) return
  if (res.ok && res.values) {
    formulaValues = res.values
    formulaCentered = !!res.meta?.centered
  }
  render()
}

// ---------------------------------------------------------------- geometry & render
function currentYearIndex(): number {
  return Number(yearSlider.value)
}
function columnsForYear(yi: number): Record<string, (number | null)[]> {
  const cols: Record<string, (number | null)[]> = {}
  for (const idx of data.indices) {
    const s = data.series[idx.id]
    cols[idx.id] = data.entities.map((e) => s[e.id]?.[yi] ?? null)
  }
  return cols
}
function valuesVector(): (number | null)[] {
  if (state.mode === 'formula') return formulaValues ?? []
  const yi = currentYearIndex()
  const s = data.series[state.index]
  return data.entities.map((e) => s[e.id]?.[yi] ?? null)
}

function renderGeometry(topo: any) {
  const fc = feature(topo, topo.objects.countries) as any
  const projection = geoNaturalEarth1().fitSize([W, H], fc)
  const pathGen = geoPath(projection)
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`)
  while (svg.firstChild) svg.removeChild(svg.firstChild)
  paths = []
  for (const f of fc.features) {
    const el = document.createElementNS(SVGNS, 'path')
    el.setAttribute('d', pathGen(f) ?? '')
    el.setAttribute('class', 'country')
    const entityId = data.geoIdToEntity[String(f.id)] ?? null
    const entry: PathEntry = { el, entityId }
    paths.push(entry)
    el.addEventListener('mousemove', (ev) => showTooltip(ev, entry))
    el.addEventListener('mouseleave', hideTooltip)
    svg.appendChild(el)
  }
}

function activeIndexMeta(): IndexMeta | null {
  return state.mode === 'index' ? data.indices.find((i) => i.id === state.index) ?? null : null
}
function higherBetter(): boolean {
  const im = activeIndexMeta()
  return im ? im.direction === 'higherBetter' : true
}

function render() {
  const values = valuesVector()
  const hb = higherBetter()
  const scheme: 'sequential' | 'diverging' = state.mode === 'formula' && formulaCentered ? 'diverging' : 'sequential'
  const bins = computeBins(values, state.binMethod, state.classes)
  let colors: string[] = []
  if (bins) {
    colors = colorsFor(bins.k, scheme).slice(0, bins.k)
    if (!hb) colors = colors.reverse()
  }

  for (const p of paths) {
    let v: number | null = null
    if (p.entityId) {
      const ei = entityIndexById.get(p.entityId)
      if (ei != null) v = values[ei]
    }
    p.el.classList.toggle('found', !!foundEntityId && p.entityId === foundEntityId)
    if (v == null || !Number.isFinite(v) || !bins) p.el.setAttribute('fill', 'var(--no-data)')
    else p.el.setAttribute('fill', colors[classOf(v, bins.breaks)])
  }

  yearLabel.textContent = String(data.years[currentYearIndex()])
  const im = activeIndexMeta()
  sourceNote.textContent = im
    ? `Источник: ${im.source} · ${im.license}` + (im.direction === 'lowerBetter' ? ' · меньше = лучше' : '')
    : 'Производный индекс (формула)'
  drawLegend(bins, colors)
}

function fmt(n: number): string {
  return Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2)
}
function drawLegend(bins: Bins | null, colors: string[]) {
  const title = state.mode === 'index' ? activeIndexMeta()?.label ?? '' : state.formula
  if (!bins) {
    legend.innerHTML = `<div class="legend-title">${esc(title)}</div>
      <div class="legend-nodata"><span class="swatch"></span> нет данных</div>`
    return
  }
  if (bins.min === bins.max) {
    legend.innerHTML = `<div class="legend-title">${esc(title)}</div>
      <div class="legend-steps"><div class="legend-step"><span class="sw" style="background:${colors[0]}"></span><span class="rng">все = ${fmt(bins.min)}</span></div></div>
      <div class="legend-nodata"><span class="swatch"></span> нет данных</div>`
    return
  }
  const edges = [bins.min, ...bins.breaks, bins.max]
  const steps = colors
    .map(
      (c, i) =>
        `<div class="legend-step"><span class="sw" style="background:${c}"></span>` +
        `<span class="rng">${fmt(edges[i])} – ${fmt(edges[i + 1])}</span></div>`,
    )
    .join('')
  legend.innerHTML = `<div class="legend-title">${esc(title)}</div>
    <div class="legend-steps">${steps}</div>
    <div class="legend-nodata"><span class="swatch"></span> нет данных</div>`
}

// ---------------------------------------------------------------- tooltip (rich)
function rankOf(v: number, values: (number | null)[], hb: boolean): { rank: number; total: number } {
  const present = values.filter((x): x is number => x != null && Number.isFinite(x))
  const rank = present.filter((x) => (hb ? x > v : x < v)).length + 1
  return { rank, total: present.length }
}
function showTooltip(ev: MouseEvent, entry: PathEntry) {
  if (!entry.entityId) return hideTooltip()
  const ei = entityIndexById.get(entry.entityId)
  if (ei == null) return hideTooltip()
  const ent = data.entities[ei]
  const values = valuesVector()
  const v = values[ei]
  const im = activeIndexMeta()
  let body = ''
  if (v == null || !Number.isFinite(v)) {
    body = `<div class="tt-main">нет данных</div>`
  } else {
    const { rank, total } = rankOf(v, values, higherBetter())
    const unit = im?.unit ? ` ${im.unit}` : ''
    body = `<div class="tt-main">${fmt(v)}${esc(unit)}</div><div class="tt-rank">ранг #${rank} / ${total}</div>`
  }
  // raw inputs context for the country (current year)
  const yi = currentYearIndex()
  const parts = data.indices
    .map((idx) => {
      const raw = data.series[idx.id]?.[ent.id]?.[yi]
      return raw == null ? null : `${idx.id} ${fmt(raw)}`
    })
    .filter(Boolean)
    .join(' · ')
  tooltip.hidden = false
  tooltip.innerHTML = `<div class="tt-name">${esc(ent.name)}</div>${body}` + (parts ? `<div class="tt-parts">${esc(parts)}</div>` : '')
  const th = tooltip.offsetHeight
  tooltip.style.left = Math.min(ev.clientX + 14, window.innerWidth - 250) + 'px'
  tooltip.style.top = Math.min(ev.clientY + 14, window.innerHeight - th - 8) + 'px'
}
function hideTooltip() {
  tooltip.hidden = true
}

// ---------------------------------------------------------------- search
function setupSearch() {
  let active = -1
  const render = (q: string) => {
    const ql = q.trim().toLowerCase()
    searchResults.innerHTML = ''
    if (!ql) {
      searchResults.hidden = true
      return
    }
    const matches = data.entities.filter((e) => e.name.toLowerCase().includes(ql)).slice(0, 8)
    if (!matches.length) {
      searchResults.hidden = true
      return
    }
    matches.forEach((e, i) => {
      const b = document.createElement('button')
      b.textContent = e.name
      if (i === active) b.classList.add('active')
      b.addEventListener('click', () => pick(e.id, e.name))
      searchResults.appendChild(b)
    })
    searchResults.hidden = false
  }
  const pick = (id: string, name: string) => {
    foundEntityId = id
    searchInput.value = name
    searchResults.hidden = true
    render('')
    renderHighlight()
  }
  searchInput.addEventListener('input', () => {
    active = -1
    foundEntityId = null
    render(searchInput.value)
    renderHighlight()
  })
  searchInput.addEventListener('keydown', (e) => {
    const btns = [...searchResults.querySelectorAll('button')]
    if (e.key === 'ArrowDown') {
      active = Math.min(active + 1, btns.length - 1)
      render(searchInput.value)
      e.preventDefault()
    } else if (e.key === 'ArrowUp') {
      active = Math.max(active - 1, 0)
      render(searchInput.value)
      e.preventDefault()
    } else if (e.key === 'Enter' && btns[active]) {
      btns[active].click()
    } else if (e.key === 'Escape') {
      searchResults.hidden = true
    }
  })
}
function renderHighlight() {
  for (const p of paths) p.el.classList.toggle('found', !!foundEntityId && p.entityId === foundEntityId)
}

// ---------------------------------------------------------------- theme, url, share
function applyTheme() {
  document.documentElement.setAttribute('data-theme', state.theme)
  themeBtn.textContent = state.theme === 'dark' ? '☀' : '☾'
}
function syncUrl() {
  history.replaceState(null, '', '#' + encodeState(state))
}
async function share() {
  syncUrl()
  const url = location.href
  try {
    await navigator.clipboard.writeText(url)
    shareBtn.textContent = 'Скопировано'
    shareBtn.classList.add('ok')
    setTimeout(() => {
      shareBtn.textContent = 'Поделиться'
      shareBtn.classList.remove('ok')
    }, 1600)
  } catch {
    shareBtn.textContent = 'Не удалось'
    setTimeout(() => {
      shareBtn.textContent = 'Поделиться'
    }, 1600)
  }
}

function esc(s: string): string {
  return s.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string)
}

void boot()
