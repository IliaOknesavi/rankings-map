// Curated example formulas — solve the blank-canvas problem and showcase the engine.
export interface Preset {
  name: string
  formula: string
}

export const PRESETS: Preset[] = [
  { name: 'ВВП на душу', formula: 'percentile_rank(gdp_pc)' },
  { name: 'Качество жизни', formula: '0.6*percentile_rank(life_exp) + 0.4*percentile_rank(gdp_pc)' },
  {
    name: 'Развитие',
    formula: '(percentile_rank(life_exp) + percentile_rank(gdp_pc) + (1 - percentile_rank(co2_pc))) / 3',
  },
  { name: 'Эко-эффективность', formula: 'percentile_rank(gdp_pc) - percentile_rank(co2_pc)' },
]
