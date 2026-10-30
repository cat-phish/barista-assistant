// A brew's caffeine, estimated from its dose (docs/api/stats.md §11, "How the
// client counts"): worked out, not stored. These are typical figures, not
// measurements, so every amount is shown with "≈".
import type { CoffeeSpecies, StatsBean, StatsBrew } from '../api/types';
import type { DayRange } from './statsRange';
import { localDay } from './stats';

const DAY_MS = 86_400_000;

// Caffeine as a share of the coffee's weight.
const SPECIES_CAFFEINE: Record<CoffeeSpecies, number> = {
  arabica: 0.012,
  robusta: 0.022,
  liberica: 0.012,
  excelsa: 0.011,
  eugenioides: 0.006,
};
const DECAF_LEFT = 0.03; // decaffeinating removes about 97%
// How much of the caffeine reaches the cup.
const EXTRACTED_ESPRESSO = 0.8;
const EXTRACTED = 0.9;

type CaffeineBean = Pick<StatsBean, 'decaf' | 'species'>;

// A blend counts each species equally (its shares aren't recorded); no species
// counts as arabica. Espresso is the brew without water (docs/api/brew-logs.md §6).
export function brewCaffeineMg(brew: Pick<StatsBrew, 'doseGrams' | 'waterGrams'>, bean?: CaffeineBean): number {
  const species = bean?.species?.length ? bean.species : (['arabica'] as const);
  const share = species.reduce((sum, s) => sum + SPECIES_CAFFEINE[s], 0) / species.length;
  const extracted = brew.waterGrams === null ? EXTRACTED_ESPRESSO : EXTRACTED;
  return brew.doseGrams * 1000 * share * extracted * (bean?.decaf ? DECAF_LEFT : 1);
}

// "≈ 165 mg" to the nearest 5 mg, "≈ 12.4 g" from a gram up.
export function formatCaffeine(mg: number): string {
  const rounded = Math.round(mg / 5) * 5;
  return rounded >= 1000 ? `≈ ${(mg / 1000).toFixed(1)} g` : `≈ ${rounded} mg`;
}

export interface CaffeineSummary {
  totalMg: number;
  perBrewMg: number;
  perDayMg: number;
  days: number;
}

// `days` counts quiet days too: from the period's start (the first brew when
// open, as the charts' axis does) to its end, never past today.
export function caffeineSummary(brews: readonly StatsBrew[], beanOf: (id: string) => CaffeineBean | undefined, range: DayRange, today: string): CaffeineSummary | null {
  const first = brews[0];
  if (!first) return null;
  const totalMg = brews.reduce((sum, b) => sum + brewCaffeineMg(b, beanOf(b.beanId)), 0);
  const from = range.from ?? localDay(first);
  const to = range.to !== null && range.to < today ? range.to : today;
  const days = Math.max(1, (Date.parse(to) - Date.parse(from)) / DAY_MS + 1);
  return { totalMg, perBrewMg: totalMg / brews.length, perDayMg: totalMg / days, days };
}
