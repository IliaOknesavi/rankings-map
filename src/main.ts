import { geoNaturalEarth1, geoPath } from 'd3-geo'
import { scaleSequential } from 'd3-scale'
import { interpolateViridis } from 'd3-scale-chromatic'
import { feature } from 'topojson-client'
import type { Dataset, FormulaRequest, FormulaResponse, IndexMeta, NormMode } from './types'

const W = 960
const H = 500
const SVGNS = 'http://www.w3.org/2000/svg'
const base = import.meta.env.BASE_URL

// ---- DOM handles ----
const svg = document.getElementById('map') as unknown as SVGSVGElement
const indexSelect = document.getElementById('indexSelect') as HTMLSelectElement
const yearSlider = document.getElementById('yearSlider') as HTMLInputElement
const yearLabel = document.getElementById('yearLabel') as HTMLElement
const normSelect = document.getElementById('normSelect') as HTMLSelectElement
const formulaInput = document.getElementById('formulaInput') as HTMLTextAreaElement
const applyBtn = document.getElementById('applyFormula') as HTMLButtonElement
const clearBtn = document.getElementById('clearFormula') as HTMLButtonElement
const formulaError = document.getElementById('formulaError') as HTMLElement
const legend = document.getElementById('legend') as HTMLElement
const statusEl = document.getElementById('status') as HTMLElement
const sourceNote = document.getElementById('sourceNote') as HTMLElement
const varList = document.getElementById('varList') as HTMLElement
const tooltip = document.getElementById('tooltip') as HTMLElement

// ---- formula worker ----
const worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
function runFormula(req: FormulaRequest): Promise<FormulaResponse> {
  return new Promise((resolve) => {
    worker.onmessage = (e: MessageEvent<FormulaResponse>) => resolve(e.data)
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
let mode: { kind: 'index'; index: IndexMeta } | { kind: 'formula'; label: string; higherBetter: boolean } = {
  kind: 'index',
  index: {} as IndexMeta,
}
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
  normSelect.addEventListener('change', () => {
    if (mode.kind === 'formula') void applyFormula()
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
  const present = values.filter((v): v is number => v != null && Number.isFinite(v))
  const min = present.length ? Math.min(...present) : 0
  const max = present.length ? Math.max(...present) : 1

  const higherBetter = mode.kind === 'formula' ? mode.higherBetter : mode.index.direction === 'higherBetter'
  // higher-better -> high maps to bright (viridis 1); lower-better -> invert
  const domain: [number, number] = higherBetter ? [min, max] : [max, min]
  const color = scaleSequential(interpolateViridis).domain(domain)

  for (const p of paths) {
    let v: number | null = null
    if (p.entityId) {
      const ei = entityIndexById.get(p.entityId)
      if (ei != null) v = values[ei]
    }
    if (v == null || !Number.isFinite(v)) {
      p.el.setAttribute('fill', 'var(--no-data)')
    } else {
      p.el.setAttribute('fill', color(v))
    }
  }

  // header / labels
  if (mode.kind === 'index') {
    yearLabel.textContent = String(data.years[currentYearIndex()])
    sourceNote.textContent = `Источник: ${mode.index.source} · ${mode.index.license}` +
      (mode.index.direction === 'lowerBetter' ? ' · меньше = лучше' : '')
  } else {
    yearLabel.textContent = String(data.years[currentYearIndex()])
    sourceNote.textContent = 'Производный индекс (формула)'
  }
  drawLegend(min, max, higherBetter)
}

function drawLegend(min: number, max: number, higherBetter: boolean) {
  const stops: string[] = []
  const N = 10
  for (let i = 0; i <= N; i++) stops.push(interpolateViridis(i / N))
  const grad = higherBetter ? stops : stops.slice().reverse()
  const css = grad.map((c, i) => `${c} ${(i / N) * 100}%`).join(', ')
  const fmt = (n: number) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2))
  legend.innerHTML = `
    <div class="legend-title">${mode.kind === 'index' ? mode.index.label : mode.label}</div>
    <div class="legend-bar" style="background: linear-gradient(to right, ${css})"></div>
    <div class="legend-axis"><span>${fmt(min)}</span><span>${fmt(max)}</span></div>
    <div class="legend-nodata"><span class="swatch"></span> нет данных</div>`
}

async function applyFormula() {
  const raw = formulaInput.value.trim()
  formulaError.textContent = ''
  if (!raw) {
    formulaError.textContent = 'Введите формулу'
    return
  }
  const yi = currentYearIndex()
  const normMode = normSelect.value as NormMode
  const columns: Record<string, (number | null)[]> = {}
  for (const idx of data.indices) {
    const s = data.series[idx.id]
    columns[idx.id] = data.entities.map((e) => s[e.id]?.[yi] ?? null)
  }
  const res = await runFormula({
    formula: raw,
    normMode,
    entityIds: data.entities.map((e) => e.id),
    columns,
  })
  if (res.error) {
    formulaError.textContent = res.error
    return
  }
  formulaValues = res.values ?? null
  mode = { kind: 'formula', label: raw, higherBetter: true }
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
