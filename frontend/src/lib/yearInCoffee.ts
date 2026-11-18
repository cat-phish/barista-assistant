// Your Year in Coffee (backlog 65, docs/api/recaps.md §11c "Your Year in
// Coffee"): 1 January to 6 December, counted and frozen on the server
// (@barista/shared/yearInCoffee) and read from GET …/recaps/year-in-coffee/:year.
// These are its types, as the API sends them; the Yearly tab counts live
// (lib/recap.ts), and yearInCoffee.parity.test.ts holds the two to the same
// results. A figure without enough behind it is null or empty, so the slides
// skip its card rather than show "1 origin".
import type { RecapFigures } from './recap';
import type { RecapPeriod } from './recapPeriods';

export interface Ranked {
  name: string;
  brews: number;
}
// How many cups got the year's top rating, the bean and recipe behind most
// of them (2 or more), and who brewed most of them (when people is shown).
export interface TopCups {
  rating: number;
  brews: number;
  bean: Ranked | null;
  recipe: Ranked | null;
  by: string | null;
}
export interface YearFigures {
  year: number;
  recap: RecapFigures; // the year as a recap counts it, next to the year before
  months: number[]; // brews per month, January first
  streak: { days: number; start: string; end: string } | null; // the longest run of days brewed, 2 or more
  busiestMonth: { month: number; brews: number } | null; // 0 = January
  busiestWeekday: { weekday: number; brews: number } | null; // 0 = Monday
  favouriteHour: { hour: number; brews: number } | null; // local, 0–23
  origins: Ranked[];
  originNames: string[]; // every origin brewed, for "new to you" (yearCompare.ts)
  roasterNames: string[];
  roasters: Ranked[];
  processes: Ranked[];
  varieties: Ranked[];
  flavors: Ranked[];
  mostImproved: { kind: 'recipe' | 'bean'; name: string; from: number; to: number; brews: number } | null;
  people: Array<{ userId: string; brews: number }>; // most brews first; empty unless 2 or more people brewed
  topCups: TopCups | null; // the cups at the year's top rating; null when none was rated (version 2)
}
// A first year someone joined partway through: compared at its pace, its
// totals scaled to the full period (docs/api/recaps.md §11c).
export interface Covered {
  from: string; // the first brew's day
  days: number; // from then to the period's end
  scale: number; // the period's days ÷ days
  tooShort: boolean; // under 30 days: left out of comparisons
}
export type HistoryYear = YearFigures & { covered?: Covered };
// What GET …/year-in-coffee/:year returns: the year and the earlier years
// to compare with, all cut to 1 January–6 December.
export interface FrozenYear {
  version: number;
  period: RecapPeriod;
  figures: YearFigures;
  history: HistoryYear[];
}

// Out on 7 December: the latest year on offer, and the one shown when none is asked for.
export const OUT_ON = '12-07';
export const latestYear = (today: string): number => Number(today.slice(0, 4)) - (today.slice(5) >= OUT_ON ? 0 : 1);

// An older frozen copy lacks the figures added since (its version is lower):
// each missing one reads as "not enough behind it", so its card is skipped.
const EMPTY: Omit<YearFigures, 'year' | 'recap'> = {
  months: Array.from({ length: 12 }, () => 0),
  streak: null,
  busiestMonth: null,
  busiestWeekday: null,
  favouriteHour: null,
  origins: [],
  originNames: [],
  roasterNames: [],
  roasters: [],
  processes: [],
  varieties: [],
  flavors: [],
  mostImproved: null,
  people: [],
  topCups: null,
};
const EMPTY_RECAP: RecapFigures = {
  brews: 0,
  previousBrews: 0,
  daysBrewed: 0,
  rating: null,
  previousRating: null,
  best: [],
  caffeineMg: null,
  volume: null,
  forOthers: null,
  coffeeGrams: 0,
  beansBrewed: [],
  beansAdded: [],
  beansFinished: [],
  newRecipes: [],
  topRecipe: null,
  topBrewer: null,
};
export function completeFigures<T extends YearFigures>(f: T): T {
  return { ...EMPTY, ...f, recap: { ...EMPTY_RECAP, ...f.recap } };
}
