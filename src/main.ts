import { geoNaturalEarth1, geoPath } from 'd3-geo'
import { feature } from 'topojson-client'
import type { Dataset, IndexMeta } from './types'
import type { EvalContext, EvalResult } from './engine/types'
import { computeBins, classOf, colorsFor, type BinMethod, type Bins } from './scale'

const W = 960
const H = 500
const SVGNS = 'http://www.w3.org/2000/svg'
const base = import.meta.env.BASE_URL

// ---- DOM handles ----
const svg = document.getElementById('map') as unknown as SVGSVGElement
const indexSelect = document.getElementById('indexSelect') as HTMLSelectElement
const yearSlider = document.getElementById('yearSlider') as HTMLInputElement
const yearLabel = document.getElementById('yearLabel') as HTMLElement
const formulaInput = document.getElementById('formulaInput') as HTMLTextAreaElement
const applyBtn = document.getElementById('applyFormula') as HTMLButtonElement
const clearBtn = document.getElementById('clearFormula') as HTMLButtonElement
const formulaError = document.getElementById('formulaError') as HTMLElement
const legend = document.getElementById('legend') as HTMLElement
const statusEl = document.getElementById('status') as HTMLElement
const sourceNote = document.getElementById('sourceNote') as HTMLElement
const varList = document.getElementById('varList') as HTMLElement
const tooltip = document.getElementById('tooltip') as HTMLElement
const binMethodSel = document.getElementById('binMethod') as HTMLSelectElement
const classCountInput = document.getElementById('classCount') as HTMLInputElement

// ---- formula worker ----
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
type FormulaReq = { formula: string } & EvalContext
function runFormula(req: FormulaReq): Promise<EvalResult> {
  return new Promise((resolve) => {
    worker.onmessage = (e: MessageEvent<EvalResult>) => resolve(e.data)
    worker.postMessage(req)
  })
}

interface PathEntry {
  el: SVGPathElement
  entityId: string | null
}

let data: Dataset
let entityIndexById: Map<string, number>
let paths: PathEntry[] = []
// active view: either a base index, or a computed formula vector
type Mode =
  | { kind: 'index'; index: IndexMeta }
  | { kind: 'formula'; label: string; higherBetter: boolean; centered: boolean }
let mode: Mode = { kind: 'index', index: {} as IndexMeta }
let binMethod: BinMethod = 'quantile'
let classes = 5
let formulaValues: (number | null)[] | null = null // aligned to data.entities

async function boot() {
  statusEl.textContent = 'Загрузка данных…'
  const [ds, topo] = await Promise.all([
    fetch(`${base}data/dataset.json`).then((r) => r.json() as Promise<Dataset>),
    fetch(`${base}data/world-110m.json`).then((r) => r.json()),
  ])
  data = ds
  entityIndexById = new Map(ds.entities.map((e, i) => [e.id, i]))

  buildControls()
  renderGeometry(topo)
  update()
  statusEl.textContent = `${ds.entities.length} стран · ${ds.years.length} лет · ${ds.indices.length} индекса`
}

function buildControls() {
  for (const idx of data.indices) {
    const opt = document.createElement('option')
    opt.value = idx.id
    opt.textContent = idx.label
    indexSelect.appendChild(opt)
  }
  mode = { kind: 'index', index: data.indices[0] }

  yearSlider.min = '0'
  yearSlider.max = String(data.years.length - 1)
  yearSlider.value = String(data.years.length - 1) // latest year

  varList.textContent = data.indices.map((i) => i.id).join(', ')

  indexSelect.addEventListener('change', () => {
    const idx = data.indices.find((i) => i.id === indexSelect.value)!
    mode = { kind: 'index', index: idx }
    formulaValues = null
    update()
  })
  yearSlider.addEventListener('input', () => {
    if (mode.kind === 'formula') {
      // recompute formula for the new year
      void applyFormula()
    } else {
      update()
    }
  })
  applyBtn.addEventListener('click', () => void applyFormula())
  clearBtn.addEventListener('click', () => {
    formulaInput.value = ''
    formulaError.textContent = ''
    formulaValues = null
    const idx = data.indices.find((i) => i.id === indexSelect.value)!
    mode = { kind: 'index', index: idx }
    update()
  })

  binMethodSel.value = binMethod
  classCountInput.value = String(classes)
  binMethodSel.addEventListener('change', () => {
    binMethod = binMethodSel.value as BinMethod
    update()
  })
  classCountInput.addEventListener('input', () => {
    classes = Math.max(3, Math.min(9, Number(classCountInput.value) || 5))
    update()
  })
}

function currentYearIndex(): number {
  return Number(yearSlider.value)
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

// returns value per entity (aligned to data.entities) for the active view
function currentVector(): (number | null)[] {
  if (mode.kind === 'formula') return formulaValues ?? []
  const yi = currentYearIndex()
  const s = data.series[mode.index.id]
  return data.entities.map((e) => s[e.id]?.[yi] ?? null)
}

function update() {
  const values = currentVector()
  const higherBetter = mode.kind === 'formula' ? mode.higherBetter : mode.index.direction === 'higherBetter'
  const scheme: 'sequential' | 'diverging' = mode.kind === 'formula' && mode.centered ? 'diverging' : 'sequential'

  const bins = computeBins(values, binMethod, classes)
  let colors = colorsFor(classes, scheme)
  if (!higherBetter) colors = colors.slice().reverse() // lower-is-better: low values get the "good" end

  for (const p of paths) {
    let v: number | null = null
    if (p.entityId) {
      const ei = entityIndexById.get(p.entityId)
      if (ei != null) v = values[ei]
    }
    if (v == null || !Number.isFinite(v) || !bins) {
      p.el.setAttribute('fill', 'var(--no-data)')
    } else {
      p.el.setAttribute('fill', colors[classOf(v, bins.breaks)])
    }
  }

  // header / labels
  yearLabel.textContent = String(data.years[currentYearIndex()])
  if (mode.kind === 'index') {
    sourceNote.textContent = `Источник: ${mode.index.source} · ${mode.index.license}` +
      (mode.index.direction === 'lowerBetter' ? ' · меньше = лучше' : '')
  } else {
    sourceNote.textContent = 'Производный индекс (формула)'
  }
  drawLegend(bins, colors)
}

function drawLegend(bins: Bins | null, colors: string[]) {
  const title = mode.kind === 'index' ? mode.index.label : mode.label
  const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2))
  if (!bins) {
    legend.innerHTML = `<div class="legend-title">${title}</div>
      <div class="legend-nodata"><span class="swatch"></span> нет данных</div>`
    return
  }
  const edges = [bins.min, ...bins.breaks, bins.max] // k+1 ascending edges
  const steps = colors
    .map(
      (c, i) =>
        `<div class="legend-step"><span class="sw" style="background:${c}"></span>` +
        `<span class="rng">${fmt(edges[i])} – ${fmt(edges[i + 1])}</span></div>`,
    )
    .join('')
  legend.innerHTML = `<div class="legend-title">${title}</div>
    <div class="legend-steps">${steps}</div>
    <div class="legend-nodata"><span class="swatch"></span> нет данных</div>`
}

async function applyFormula() {
  const raw = formulaInput.value.trim()
  formulaError.textContent = ''
  if (!raw) {
    formulaError.textContent = 'Введите формулу'
    return
  }
  // allow optional "Name = expression" — evaluate the right-hand side
  const formula = raw.replace(/^\s*[A-Za-z_]\w*\s*=(?!=)\s*/, '')
  const yi = currentYearIndex()
  const columns: Record<string, (number | null)[]> = {}
  for (const idx of data.indices) {
    const s = data.series[idx.id]
    columns[idx.id] = data.entities.map((e) => s[e.id]?.[yi] ?? null)
  }
  const res = await runFormula({ formula, columns, entityCount: data.entities.length })
  if (!res.ok || !res.values) {
    formulaError.textContent = res.error?.message ?? 'Ошибка вычисления'
    return
  }
  formulaValues = res.values
  mode = { kind: 'formula', label: raw, higherBetter: true, centered: !!res.meta?.centered }
  update()
}

function showTooltip(ev: MouseEvent, entry: PathEntry) {
  if (!entry.entityId) {
    hideTooltip()
    return
  }
  const ei = entityIndexById.get(entry.entityId)
  const ent = ei != null ? data.entities[ei] : null
  const values = currentVector()
  const v = ei != null ? values[ei] : null
  const name = ent ? ent.name : entry.entityId
  const vText = v == null || !Number.isFinite(v) ? 'нет данных' : (Math.abs(v) >= 100 ? v.toFixed(0) : v.toFixed(2))
  tooltip.hidden = false
  tooltip.innerHTML = `<b>${name}</b><br>${vText}`
  tooltip.style.left = ev.clientX + 12 + 'px'
  tooltip.style.top = ev.clientY + 12 + 'px'
}
function hideTooltip() {
  tooltip.hidden = true
}

void boot()
