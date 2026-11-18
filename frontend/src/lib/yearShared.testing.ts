// For tests only: the server's copy of Your Year in Coffee's counting
// (@barista/shared/yearInCoffee), loaded as it is. A glob, not an import, so
// the frontend image (no shared/) still type-checks; typed here in the
// frontend's own terms (the Insights rows it counts from are a superset).
import type { RoastLevel, StatsData } from '../api/types';
import type { RecapFigures } from './recap';
import type { RecapPeriod } from './recapPeriods';
import type { FrozenYear, HistoryYear, YearFigures } from './yearInCoffee';

export interface SharedYear {
  YEAR_ENDS_ON: string;
  latestYearInCoffee: (today: string) => number;
  recapFigures: (data: StatsData, previous: StatsData | null, period: RecapPeriod, recipeRoastLevel: RoastLevel, today: string) => RecapFigures;
  yearFigures: (data: StatsData, previous: StatsData | null, period: RecapPeriod, recipeRoastLevel: RoastLevel, today: string) => YearFigures;
  yearHistory: (data: StatsData, year: number, recipeRoastLevel: RoastLevel, today: string) => HistoryYear[];
  longestStreak: (days: readonly string[]) => YearFigures['streak'];
  freezeYear: (all: StatsData, year: number, recipeRoastLevel: RoastLevel, today: string) => FrozenYear;
}
export const shared = Object.values(import.meta.glob<SharedYear>('../../../shared/src/yearInCoffee.ts', { eager: true }))[0]!;
