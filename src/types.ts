export type Direction = 'higherBetter' | 'lowerBetter'

export interface IndexMeta {
  id: string
  label: string
  unit: string
  direction: Direction
  source: string
  license: string
  url: string
}

export interface EntityMeta {
  id: string // ISO 3166-1 alpha-3 for the country entity type
  name: string
  region: string
}

export interface Dataset {
  schemaVersion: number
  generatedAt: string
  entityType: string // 'country' for v1; the model generalizes to region/city/university
  years: number[]
  entities: EntityMeta[]
  indices: IndexMeta[]
  // series[indexId][entityId] = value per year, aligned to `years`, null = missing
  series: Record<string, Record<string, (number | null)[]>>
  // maps TopoJSON numeric feature id -> entity id (ISO3)
  geoIdToEntity: Record<string, string>
}

// Formula evaluation types now live in src/engine (EvalContext / EvalResult).
