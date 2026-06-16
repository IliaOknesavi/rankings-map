import { readFileSync, writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { geoNaturalEarth1, geoPath } from 'd3-geo'
import { scaleSequential } from 'd3-scale'
import { interpolateViridis } from 'd3-scale-chromatic'
import { feature } from 'topojson-client'
import { Parser } from 'expr-eval'
import { Resvg } from '@resvg/resvg-js'

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const DATA = resolve(ROOT, 'public', 'data')

const ds = JSON.parse(readFileSync(resolve(DATA, 'dataset.json'), 'utf8'))
const topo = JSON.parse(readFileSync(resolve(DATA, 'world-110m.json'), 'utf8'))

const Wc = 1200, Hc = 690
const mapW = 1160, mapH = 545, mapX = 20, mapY = 52

const fc = feature(topo, topo.objects.countries)
const projection = geoNaturalEarth1().fitSize([mapW, mapH], fc)
const pathGen = geoPath(projection)

const yi = ds.years.length - 1
const year = ds.years[yi]
const entityIndex = new Map(ds.entities.map((e, i) => [e.id, i]))

function columnFor(indexId) {
  const s = ds.series[indexId]
  return ds.entities.map((e) => (s[e.id]?.[yi] ?? null))
}
function normalize(col, mode) {
  const present = col.filter((v) => v != null && Number.isFinite(v))
  if (mode === 'none' || !present.length) return col.map((v) => (v == null ? NaN : v))
  if (mode === 'zscore') {
    const m = present.reduce((a, b) => a + b, 0) / present.length
    const sd = Math.sqrt(present.reduce((a, b) => a + (b - m) ** 2, 0) / present.length)
    return col.map((v) => (v == null || sd === 0 ? NaN : (v - m) / sd))
  }
  const mn = Math.min(...present), mx = Math.max(...present)
  return col.map((v) => (v == null || mx === mn ? NaN : (v - mn) / (mx - mn)))
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }

function buildVector({ indexId, formula, normMode = 'zscore' }) {
  if (indexId) {
    const idx = ds.indices.find((i) => i.id === indexId)
    return { values: columnFor(indexId), higherBetter: idx.direction === 'higherBetter', title: `${idx.label} · ${year}`, src: `${idx.source} · ${idx.license}` }
  }
  const cols = {}
  for (const idx of ds.indices) cols[idx.id] = normalize(columnFor(idx.id), normMode)
  const expr = new Parser().parse(formula.includes('=') ? formula.slice(formula.indexOf('=') + 1) : formula)
  const values = ds.entities.map((_, i) => {
    const scope = {}
    for (const idx of ds.indices) scope[idx.id] = cols[idx.id][i]
    try { const r = expr.evaluate(scope); return Number.isFinite(r) ? r : null } catch { return null }
  })
  return { values, higherBetter: true, title: `Формула: ${formula} · ${year} · (норм. ${normMode})`, src: 'Производный индекс' }
}

function renderSVG(spec) {
  const { values, higherBetter, title, src } = buildVector(spec)
  const present = values.filter((v) => v != null && Number.isFinite(v))
  const min = Math.min(...present), max = Math.max(...present)
  const color = scaleSequential(interpolateViridis).domain(higherBetter ? [min, max] : [max, min])

  let paths = ''
  for (const f of fc.features) {
    const iso3 = ds.geoIdToEntity[String(f.id)]
    const ei = iso3 != null ? entityIndex.get(iso3) : null
    const v = ei != null ? values[ei] : null
    const fill = v == null || !Number.isFinite(v) ? '#2a3140' : color(v)
    const d = pathGen(f)
    if (d) paths += `<path d="${d}" fill="${fill}" stroke="#0c1018" stroke-width="0.4"/>`
  }

  // legend gradient
  let stops = ''
  const N = 12
  for (let i = 0; i <= N; i++) {
    const t = i / N
    const c = interpolateViridis(higherBetter ? t : 1 - t)
    stops += `<stop offset="${(t * 100).toFixed(1)}%" stop-color="${c}"/>`
  }
  const fmt = (n) => (Math.abs(n) >= 100 ? n.toFixed(0) : n.toFixed(2))
  const lx = 20, ly = Hc - 40, lw = 380

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${Wc}" height="${Hc}" viewBox="0 0 ${Wc} ${Hc}" font-family="DejaVu Sans, Arial, sans-serif">
<rect width="${Wc}" height="${Hc}" fill="#0e1420"/>
<text x="20" y="32" fill="#e7ecf5" font-size="22" font-weight="700">${esc(title)}</text>
<g transform="translate(${mapX},${mapY})">${paths}</g>
<defs><linearGradient id="lg" x1="0" y1="0" x2="1" y2="0">${stops}</linearGradient></defs>
<rect x="${lx}" y="${ly}" width="${lw}" height="16" rx="3" fill="url(#lg)" stroke="#2b3445"/>
<text x="${lx}" y="${ly - 6}" fill="#95a2bd" font-size="13">${esc(src)}</text>
<text x="${lx}" y="${ly + 34}" fill="#95a2bd" font-size="13">${fmt(min)}</text>
<text x="${lx + lw}" y="${ly + 34}" fill="#95a2bd" font-size="13" text-anchor="end">${fmt(max)}</text>
<rect x="${lx + lw + 30}" y="${ly}" width="16" height="16" rx="3" fill="#2a3140" stroke="#2b3445"/>
<text x="${lx + lw + 54}" y="${ly + 13}" fill="#95a2bd" font-size="13">нет данных</text>
</svg>`
}

const out = process.argv[2] || 'map.png'
const spec = process.argv[3]
  ? { formula: process.argv[3], normMode: process.argv[4] || 'zscore' }
  : { indexId: 'gdp_pc' }
const svg = renderSVG(spec)
const png = new Resvg(svg, { background: '#0e1420', fitTo: { mode: 'width', value: Wc }, font: { loadSystemFonts: true } }).render().asPng()
writeFileSync(out, png)
console.log('wrote', out, png.length, 'bytes')
