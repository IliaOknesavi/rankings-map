# Data schema contract

The app loads two static artifacts (built by `scripts/etl.ts`) from `public/data/`:
`dataset.json` (the data) and `world-110m.json` (TopoJSON geometry). `dataset.json` is the
**stable data contract**; breaking changes bump `schemaVersion`.

## `dataset.json`

```ts
interface Dataset {
  schemaVersion: number      // contract version; currently 1
  generatedAt: string        // ISO timestamp of the ETL run
  entityType: string         // 'country' for v1 (ISO 3166-1 alpha-3 ids)
  years: number[]            // ascending; series arrays are aligned to this
  entities: {
    id: string               // ISO3, e.g. "DEU"
    name: string             // display name
    region: string
  }[]
  indices: {
    id: string               // formula variable name, e.g. "gdp_pc"
    label: string
    unit: string
    direction: 'higherBetter' | 'lowerBetter'
    source: string           // e.g. "World Bank"
    license: string          // e.g. "CC BY 4.0"
    url: string
  }[]
  // series[indexId][entityId] = value per year, aligned to `years`; null = missing
  series: Record<string, Record<string, (number | null)[]>>
  // TopoJSON numeric feature id -> entity id (ISO3)
  geoIdToEntity: Record<string, string>
}
```

Constraints: every `series[indexId][entityId]` array has `years.length` entries; missing data
is `null` (never imputed). `indices[].id` values are the variable names usable in formulas.

## Engine adapter (`EvalContext`)

The formula engine (`src/engine`) is decoupled from this file format. For a chosen year index
`yi`, the app builds an `EvalContext`:

```ts
const columns: Record<string, (number | null)[]> = {}
for (const idx of dataset.indices) {
  const s = dataset.series[idx.id]
  columns[idx.id] = dataset.entities.map((e) => s[e.id]?.[yi] ?? null)
}
const ctx = { columns, entityCount: dataset.entities.length }
```

Each column is aligned to `dataset.entities` order and has length `entityCount`. The engine
returns a `values` column in the same order; `geoIdToEntity` maps map features to entity ids
for rendering.

## Versioning

- `schemaVersion` — bump on any breaking change to `dataset.json` shape.
- Engine: `ENGINE_VERSION` (module) and `LANG_VERSION` (formula language) are exported from
  `src/engine`; bump `LANG_VERSION` on breaking changes to formula semantics.
