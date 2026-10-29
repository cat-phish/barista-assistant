// Labels and helpers for a bean's optional details (docs/api/beans.md §4).
import type { Bean, BlendType, CoffeeSpecies, DetailedRoastLevel, RoastLevel, RoastScale, RoastType } from '../api/types';
import { ROAST_LEVELS } from './scale';
import { localDateInput } from './format';
import { enumColumn, type SortColumns } from './listSort';
import { distinctNames } from './nameSuggest';
import { effectiveRoastAge } from './roastAge';

export const ROAST_TYPES: Record<RoastType, { label: string }> = {
  filter: { label: 'Filter' },
  espresso: { label: 'Espresso' },
  omni: { label: 'Omni' },
};

// Lightest to darkest, each with the 5-step level it implies
// (docs/schema.md DETAILED_ROAST_TO_LEVEL). Picking one in the bean form
// fills in roastLevel, which the yield estimate uses.
export const DETAILED_ROAST_LEVELS: Record<DetailedRoastLevel, { label: string; roastLevel: RoastLevel }> = {
  cinnamon: { label: 'Cinnamon', roastLevel: 'light' },
  american: { label: 'American', roastLevel: 'light' },
  new_england: { label: 'New England', roastLevel: 'light' },
  half_city: { label: 'Half City', roastLevel: 'light' },
  modern_light: { label: 'Modern-Light', roastLevel: 'medium_light' },
  city: { label: 'City', roastLevel: 'medium_light' },
  city_plus: { label: 'City+', roastLevel: 'medium' },
  full_city: { label: 'Full City', roastLevel: 'medium' },
  full_city_plus: { label: 'Full City+', roastLevel: 'medium_dark' },
  italian: { label: 'Italian', roastLevel: 'dark' },
  vienna: { label: 'Vienna', roastLevel: 'dark' },
  french: { label: 'French', roastLevel: 'dark' },
};

export const BLEND_TYPES: Record<BlendType, { label: string }> = {
  single_origin: { label: 'Single origin' },
  blend: { label: 'Blend' },
  other: { label: 'Other' },
};

// docs/schema.md COFFEE_SPECIES, in its order.
export const COFFEE_SPECIES: Record<CoffeeSpecies, { label: string }> = {
  arabica: { label: 'Arabica' },
  robusta: { label: 'Robusta' },
  liberica: { label: 'Liberica' },
  excelsa: { label: 'Excelsa' },
  eugenioides: { label: 'Eugenioides' },
};
export const speciesLabel = (species: readonly CoffeeSpecies[] | null): string | null =>
  species?.length ? species.map((s) => COFFEE_SPECIES[s].label).join(' & ') : null;
// "SL28, SL34 · Arabica", either part alone, or null.
export function varietyLabel(b: Pick<Bean, 'varieties' | 'species'>): string | null {
  return [b.varieties?.join(', '), speciesLabel(b.species)].filter(Boolean).join(' · ') || null;
}


// " · Batch 3" after a bean's name, or '' without a batch no.
export function batchSuffix(b: Pick<Bean, 'batchNumber'>): string {
  return b.batchNumber ? ` · Batch ${b.batchNumber}` : '';
}

// "Onyx – Southern Weather · Batch 3", for bean pickers.
export function beanLabel(b: Pick<Bean, 'roasterName' | 'beanName' | 'batchNumber'>): string {
  return `${b.roasterName} – ${b.beanName}${batchSuffix(b)}`;
}

// A copied bean is usually the next roast: "3" → "4". Anything that isn't a
// whole number ("R-12") starts blank.
export function nextBatch(batch: string | null): string {
  return batch && /^\d+$/.test(batch.trim()) ? String(Number(batch.trim()) + 1) : '';
}

// "1,950 m" or "6,398 ft" (stored in metres; feet are a preference).
export { formatAltitude } from './units';

// Price of one gram, or null without a price and bag weight.
export function pricePerGram(bean: Pick<Bean, 'priceAmount' | 'priceCurrency' | 'bagWeightGrams'>): { amount: number; currency: string } | null {
  if (bean.priceAmount === null || bean.priceCurrency === null || !bean.bagWeightGrams) return null;
  return { amount: bean.priceAmount / bean.bagWeightGrams, currency: bean.priceCurrency };
}

// "0.076 USD/g": three decimals, since a gram usually costs a few cents.
export function formatPricePerGram(price: { amount: number; currency: string }): string {
  return `${price.amount.toFixed(3)} ${price.currency}/g`;
}

// "21.50 USD"
export function formatPrice(amount: number, currency: string): string {
  return `${amount.toFixed(2)} ${currency}`;
}

// The form suggests the currency used last, per device.
const CURRENCY_KEY = 'barista.lastCurrency';
export function lastCurrency(): string {
  try {
    return localStorage.getItem(CURRENCY_KEY) ?? '';
  } catch {
    return '';
  }
}
export function rememberCurrency(code: string): void {
  try {
    localStorage.setItem(CURRENCY_KEY, code);
  } catch {
    // Storage unavailable (private mode): the form just won't prefill.
  }
}

// Freeze state: frozen now, thawed (frozen before), or never frozen.
export type FreezeState = 'frozen' | 'thawed' | 'never';
export const FREEZE_STATES = ['frozen', 'thawed', 'never'] as const satisfies readonly FreezeState[];
export function freezeState(bean: Pick<Bean, 'frozen' | 'freezePeriods'>): FreezeState {
  if (bean.frozen) return 'frozen';
  return bean.freezePeriods.length ? 'thawed' : 'never';
}

// Freeze periods, latest first, the way the API picks the one that can be
// edited (docs/api/beans.md §4): the open one, else by thaw then freeze date.
type Period = Bean['freezePeriods'][number];
export function periodsLatestFirst(periods: readonly Period[]): Period[] {
  return [...periods].sort((a, b) => {
    if (a.thawedOn === null || b.thawedOn === null) return a.thawedOn === b.thawedOn ? 0 : a.thawedOn === null ? -1 : 1;
    return b.thawedOn.localeCompare(a.thawedOn) || b.frozenOn.localeCompare(a.frozenOn);
  });
}
// The latest thaw date, or '' if never thawed.
export function latestThaw(periods: readonly Period[]): string {
  return periods.reduce((max, p) => (p.thawedOn && p.thawedOn > max ? p.thawedOn : max), '');
}
// Whole days between two YYYY-MM-DD dates.
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);

// How a list shows a bean's roast: the name when the workspace records roast
// names and the bean has one ("City+"), else the 5-step level ("Medium").
export function roastLabel(bean: Pick<Bean, 'detailedRoastLevel' | 'roastLevel'>, scale: RoastScale): string | null {
  if (scale === 'names' && bean.detailedRoastLevel) return DETAILED_ROAST_LEVELS[bean.detailedRoastLevel].label;
  return bean.roastLevel ? ROAST_LEVELS[bean.roastLevel].label : null;
}

// Lightness on the 12-step scale: the roast name's position, else the first
// name that implies the bean's 5-step level. null = unknown.
const DETAILED_ORDER = Object.keys(DETAILED_ROAST_LEVELS) as DetailedRoastLevel[];
export function roastRank(bean: Pick<Bean, 'detailedRoastLevel' | 'roastLevel'>): number | null {
  if (bean.detailedRoastLevel) return DETAILED_ORDER.indexOf(bean.detailedRoastLevel);
  if (!bean.roastLevel) return null;
  const level = bean.roastLevel;
  return DETAILED_ORDER.findIndex((d) => DETAILED_ROAST_LEVELS[d].roastLevel === level);
}

// Effective roast age in days today (frozen days don't count), or null
// without a roast date.
export function roastAgeDays(bean: Pick<Bean, 'roastDate' | 'freezePeriods'>, today: string = localDateInput()): number | null {
  return bean.roastDate ? effectiveRoastAge(bean.roastDate, bean.freezePeriods, today).ageDays : null;
}

// Every way the bean list sorts (headers and the Sort by dropdown;
// lib/listSort.ts), in the dropdown's order. Unset values sort last either way.
export type BeanSortColumn =
  | 'name' | 'roaster' | 'added' | 'purchased' | 'roastDate' | 'age' | 'roast'
  | 'process' | 'variety' | 'frozen' | 'decaf' | 'rating' | 'stock';
// processName: the workspace's name for a processId (they're editable,
// docs/api/bean-processes.md §4b); labels don't depend on it.
export const beanSortColumns = (processName: (id: string) => string | null = () => null): SortColumns<Bean, BeanSortColumn> => ({
  name: { label: 'Name', value: (b) => b.beanName, asc: 'A–Z', desc: 'Z–A' },
  roaster: { label: 'Roaster', value: (b) => b.roasterName, asc: 'A–Z', desc: 'Z–A' },
  added: { label: 'Date added', value: (b) => b.createdAt, asc: 'Oldest first', desc: 'Newest first', firstDir: 'desc' },
  purchased: { label: 'Date purchased', value: (b) => b.purchaseDate, asc: 'Oldest first', desc: 'Newest first', firstDir: 'desc' },
  roastDate: { label: 'Roast date', value: (b) => b.roastDate, asc: 'Oldest first', desc: 'Newest first', firstDir: 'desc' },
  age: { label: 'Age', value: (b) => roastAgeDays(b), asc: 'Freshest first', desc: 'Oldest first' },
  roast: { label: 'Roast level', value: roastRank, asc: 'Lightest first', desc: 'Darkest first' },
  process: { label: 'Process', value: (b) => (b.processId ? processName(b.processId) : null), asc: 'A–Z', desc: 'Z–A' },
  variety: { label: 'Variety', value: (b) => b.varieties?.[0] ?? null, asc: 'A–Z', desc: 'Z–A' },
  frozen: { ...enumColumn<Bean, FreezeState>('Frozen', FREEZE_STATES, freezeState), asc: 'Frozen first', desc: 'Never frozen first' },
  decaf: { label: 'Caffeinated / decaf', value: (b) => (b.decaf ? 1 : 0), asc: 'Caffeinated first', desc: 'Decaf first' },
  rating: { label: 'Rating', value: (b) => b.rating, asc: 'Lowest first', desc: 'Highest first', firstDir: 'desc' },
  stock: { label: 'In stock', value: (b) => b.inventoryWeightGrams, asc: 'Least first', desc: 'Most first', firstDir: 'desc' },
});

// The list's Filter dropdown: these, then each variety and species the
// workspace's beans have ("variety:<name>", "species:<key>").
export type BeanFilterKey = 'all' | 'in_stock' | 'out_of_stock' | 'frozen' | 'decaf';
export type BeanFilter = BeanFilterKey | `variety:${string}` | `species:${CoffeeSpecies}`;
export const BEAN_FILTERS: Record<BeanFilterKey, { label: string; test: (b: Bean) => boolean }> = {
  all: { label: 'All beans', test: () => true },
  in_stock: { label: 'In stock', test: (b) => b.inventoryWeightGrams > 0 },
  out_of_stock: { label: 'Out of stock', test: (b) => b.inventoryWeightGrams === 0 },
  frozen: { label: 'Frozen', test: (b) => freezeState(b) === 'frozen' },
  decaf: { label: 'Decaf', test: (b) => b.decaf },
};
const isSpecies = (v: string): v is CoffeeSpecies => v in COFFEE_SPECIES;
export const isBeanFilter = (v: unknown): v is BeanFilter =>
  typeof v === 'string' &&
  (v in BEAN_FILTERS || (v.startsWith('variety:') && v.length > 8) || (v.startsWith('species:') && isSpecies(v.slice(8))));
// A variety matches ignoring case.
export function beanFilter(f: BeanFilter): { label: string; test: (b: Bean) => boolean } {
  if (f.startsWith('variety:')) {
    const name = f.slice(8);
    return { label: name, test: (b) => !!b.varieties?.some((v) => v.toLowerCase() === name.toLowerCase()) };
  }
  if (f.startsWith('species:')) {
    const species = f.slice(8) as CoffeeSpecies;
    return { label: COFFEE_SPECIES[species].label, test: (b) => !!b.species?.includes(species) };
  }
  return BEAN_FILTERS[f as BeanFilterKey];
}
export interface BeanFilterOption {
  value: BeanFilter;
  label: string;
  group?: string;
}
// The fixed filters, then the varieties (each once, in the spelling used
// most) and species these beans have; current stays offered while chosen.
export function beanFilterOptions(beans: readonly Bean[], current: BeanFilter = 'all'): BeanFilterOption[] {
  const options: BeanFilterOption[] = Object.entries(BEAN_FILTERS).map(([value, f]) => ({ value: value as BeanFilter, label: f.label }));
  const varieties = distinctNames(beans.flatMap((b) => b.varieties ?? []));
  if (current.startsWith('variety:') && !varieties.includes(current.slice(8))) varieties.push(current.slice(8));
  options.push(...varieties.map((v) => ({ value: `variety:${v}` as BeanFilter, label: v, group: 'Variety' })));
  const species = (Object.keys(COFFEE_SPECIES) as CoffeeSpecies[]).filter((s) => current === `species:${s}` || beans.some((b) => b.species?.includes(s)));
  options.push(...species.map((s) => ({ value: `species:${s}` as BeanFilter, label: COFFEE_SPECIES[s].label, group: 'Species' })));
  return options;
}
