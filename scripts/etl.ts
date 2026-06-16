/**
 * Build-time ETL — the only "backend".
 * Fetches a few open World Bank indices (multi-year), harmonizes country codes
 * to ISO 3166-1 alpha-3, and emits static artifacts the static client loads once.
 *
 * Run: npm run etl
 */
import { createRequire } from 'node:module'
import { mkdirSync, writeFileSync, copyFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

const require = createRequire(import.meta.url)
const countries = require('i18n-iso-countries') as {
  numericToAlpha3: (n: string) => string | undefined
}

const __dirname = dirname(fileURLToPath(import.meta.url))
const ROOT = resolve(__dirname, '..')
const OUT_DIR = resolve(ROOT, 'public', 'data')

const Y0 = 2000
const Y1 = 2022
const YEARS: number[] = []
for (let y = Y0; y <= Y1; y++) YEARS.push(y)

interface IndexDef {
  id: string
  label: string
  unit: string
  direction: 'higherBetter' | 'lowerBetter'
  wbCode: string
  source?: number // World Bank database id (default 2; WGI = 3)
}

const INDICES: IndexDef[] = [
  { id: 'gdp_pc', label: 'ВВП на душу (тек. US$)', unit: 'US$', direction: 'higherBetter', wbCode: 'NY.GDP.PCAP.CD' },
  { id: 'life_exp', label: 'Ожид. продолжительность жизни', unit: 'лет', direction: 'higherBetter', wbCode: 'SP.DYN.LE00.IN' },
  { id: 'co2_pc', label: 'CO₂ на душу (т)', unit: 'т', direction: 'lowerBetter', wbCode: 'EN.GHG.CO2.PC.CE.AR5' },
  // corruption: WGI Control of Corruption (higher = better control / less corruption); WGI lives in source 3
  { id: 'corruption_control', label: 'Контроль коррупции (WGI)', unit: 'индекс −2.5…2.5', direction: 'higherBetter', wbCode: 'GOV_WGI_CC.EST', source: 3 },
  // capital concentration (income-inequality proxies; true wealth shares aren't on the WB API)
  { id: 'gini', label: 'Неравенство доходов (Джини)', unit: 'индекс 0–100', direction: 'lowerBetter', wbCode: 'SI.POV.GINI' },
  { id: 'income_top10', label: 'Доля дохода верхних 10%', unit: '%', direction: 'lowerBetter', wbCode: 'SI.DST.10TH.10' },
]

const SOURCE = 'World Bank'
const LICENSE = 'CC BY 4.0'

interface WBRow {
  countryiso3code: string
  date: string
  value: number | null
}

async function wbGet(url: string): Promise<any> {
  const r = await fetch(url, { headers: { 'User-Agent': 'rankings-map-etl' } })
  if (!r.ok) throw new Error(`HTTP ${r.status} for ${url}`)
  return r.json()
}

async function fetchCountries(): Promise<{ id: string; name: string; region: string }[]> {
  const j = await wbGet('https://api.worldbank.org/v2/country?format=json&per_page=400')
  const rows: any[] = j[1] ?? []
  // aggregates have region.id === 'NA'; real countries have a real region
  return rows
    .filter((c) => c.region?.id && c.region.id !== 'NA')
    .map((c) => ({ id: c.id as string, name: c.name as string, region: c.region.value as string }))
}

async function fetchIndicator(code: string, source?: number): Promise<WBRow[]> {
  const src = source ? `&source=${source}` : ''
  const url = `https://api.worldbank.org/v2/country/all/indicator/${code}?format=json&per_page=20000&date=${Y0}:${Y1}${src}`
  const j = await wbGet(url)
  if (!Array.isArray(j) || j.length < 2 || !Array.isArray(j[1])) throw new Error(`unexpected payload for ${code}`)
  const meta = j[0]
  if (meta?.pages && meta.pages > 1) {
    console.warn(`  ! ${code}: ${meta.pages} pages, only first fetched (raise per_page)`)
  }
  return j[1] as WBRow[]
}

async function main() {
  console.log('1/4 country list…')
  const entities = await fetchCountries()
  const validIso3 = new Set(entities.map((e) => e.id))
  console.log(`    ${entities.length} countries`)

  const yearIndex = new Map(YEARS.map((y, i) => [y, i]))
  const series: Record<string, Record<string, (number | null)[]>> = {}

  console.log('2/4 indicators…')
  for (const idx of INDICES) {
    const rows = await fetchIndicator(idx.wbCode, idx.source)
    const byEntity: Record<string, (number | null)[]> = {}
    for (const e of entities) byEntity[e.id] = new Array(YEARS.length).fill(null)
    let filled = 0
    for (const row of rows) {
      const iso3 = row.countryiso3code
      if (!iso3 || !validIso3.has(iso3)) continue
      const yi = yearIndex.get(Number(row.date))
      if (yi == null) continue
      if (row.value != null) {
        byEntity[iso3][yi] = row.value
        filled++
      }
    }
    series[idx.id] = byEntity
    console.log(`    ${idx.id}: ${filled} datapoints`)
  }

  console.log('3/4 geometry + ISO3 crosswalk…')
  const topo = require('world-atlas/countries-110m.json') as any
  const geoIdToEntity: Record<string, string> = {}
  let mapped = 0
  let unmapped = 0
  for (const g of topo.objects.countries.geometries) {
    const raw = String(g.id)
    const iso3 = countries.numericToAlpha3(raw.padStart(3, '0'))
    if (iso3 && validIso3.has(iso3)) {
      geoIdToEntity[raw] = iso3
      mapped++
    } else {
      unmapped++
    }
  }
  console.log(`    geometry features mapped: ${mapped}, unmapped (Antarctica/disputed/no-data): ${unmapped}`)

  console.log('4/4 writing artifacts…')
  mkdirSync(OUT_DIR, { recursive: true })
  copyFileSync(require.resolve('world-atlas/countries-110m.json'), resolve(OUT_DIR, 'world-110m.json'))

  const dataset = {
    schemaVersion: 1,
    generatedAt: new Date().toISOString(),
    entityType: 'country',
    years: YEARS,
    entities,
    indices: INDICES.map((i) => ({
      id: i.id,
      label: i.label,
      unit: i.unit,
      direction: i.direction,
      source: SOURCE,
      license: LICENSE,
      url: `https://data.worldbank.org/indicator/${i.wbCode}`,
    })),
    series,
    geoIdToEntity,
  }
  writeFileSync(resolve(OUT_DIR, 'dataset.json'), JSON.stringify(dataset))
  const kb = (s: string) => (Buffer.byteLength(JSON.stringify((dataset as any)[s] ?? dataset)) / 1024).toFixed(0)
  console.log(`    dataset.json written (series ~${kb('series')} KB)`)
  console.log('done.')
}

main().catch((e) => {
  console.error('ETL failed:', e)
  process.exit(1)
})
