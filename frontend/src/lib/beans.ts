// Labels and helpers for a bean's optional details (docs/api/beans.md §4).
import type { Bean, BeanProcess, BlendType, DetailedRoastLevel, RoastLevel, RoastType } from '../api/types';
import { enumColumn, type SortColumns } from './listSort';

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

// docs/schema.md BEAN_PROCESSES; editable per workspace later (backlog item 2).
export const BEAN_PROCESSES: Record<BeanProcess, { label: string }> = {
  washed: { label: 'Washed' },
  natural: { label: 'Natural' },
  wet_hulled: { label: 'Wet-Hulled' },
  honey: { label: 'Honey' },
  mechanically_washed: { label: 'Mechanically Washed' },
  anaerobic: { label: 'Anaerobic Fermentation' },
  carbonic_maceration: { label: 'Carbonic Maceration' },
  co_fermentation: { label: 'Co-Fermentation' },
  thermal_shock: { label: 'Thermal Shock' },
  lactic: { label: 'Lactic Fermentation' },
};

// "1,950 m". Stored in metres; a feet option is backlog item 3.
export function formatAltitude(masl: number): string {
  return `${masl.toLocaleString('en-US')} m`;
}

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
export function freezeState(bean: Pick<Bean, 'freezePeriods'>): FreezeState {
  const last = bean.freezePeriods[bean.freezePeriods.length - 1];
  if (!last) return 'never';
  return last.thawedOn === null ? 'frozen' : 'thawed';
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

// Every way the bean list sorts (headers and the Sort dropdown; lib/listSort.ts).
// Unset values sort last either way.
export type BeanSortColumn =
  | 'name' | 'roaster' | 'added' | 'purchased' | 'frozen' | 'roast'
  | 'process' | 'rating' | 'roastDate' | 'stock' | 'decaf';
export const BEAN_SORT_COLUMNS: SortColumns<Bean, BeanSortColumn> = {
  name: { label: 'Name', value: (b) => b.beanName, asc: 'Name A–Z', desc: 'Name Z–A' },
  roaster: { label: 'Roaster', value: (b) => b.roasterName, asc: 'Roaster A–Z', desc: 'Roaster Z–A' },
  added: { label: 'Added', value: (b) => b.createdAt, asc: 'Oldest added', desc: 'Newest added', firstDir: 'desc' },
  purchased: { label: 'Purchased', value: (b) => b.purchaseDate, asc: 'Oldest purchase', desc: 'Newest purchase', firstDir: 'desc' },
  frozen: { ...enumColumn<Bean, FreezeState>('Frozen', FREEZE_STATES, freezeState), asc: 'Frozen first', desc: 'Never frozen first' },
  roast: { label: 'Roast', value: roastRank, asc: 'Lightest roast first', desc: 'Darkest roast first' },
  process: { label: 'Process', value: (b) => (b.process ? BEAN_PROCESSES[b.process].label : null), asc: 'Process A–Z', desc: 'Process Z–A' },
  rating: { label: 'Rating', value: (b) => b.rating, asc: 'Lowest rated', desc: 'Highest rated', firstDir: 'desc' },
  roastDate: { label: 'Roast date', value: (b) => b.roastDate, asc: 'Oldest roast', desc: 'Newest roast', firstDir: 'desc' },
  stock: { label: 'Stock', value: (b) => b.inventoryWeightGrams, asc: 'Least in stock', desc: 'Most in stock', firstDir: 'desc' },
  decaf: { label: 'Decaf', value: (b) => (b.decaf ? 1 : 0), asc: 'Caffeinated first', desc: 'Decaf first' },
};

// The list's Filter dropdown.
export type BeanFilter = 'all' | 'in_stock' | 'out_of_stock' | 'frozen' | 'decaf';
export const BEAN_FILTERS: Record<BeanFilter, { label: string; test: (b: Bean) => boolean }> = {
  all: { label: 'All beans', test: () => true },
  in_stock: { label: 'In stock', test: (b) => b.inventoryWeightGrams > 0 },
  out_of_stock: { label: 'Out of stock', test: (b) => b.inventoryWeightGrams === 0 },
  frozen: { label: 'Frozen', test: (b) => freezeState(b) === 'frozen' },
  decaf: { label: 'Decaf', test: (b) => b.decaf },
};
export const isBeanFilter = (v: unknown): v is BeanFilter => typeof v === 'string' && v in BEAN_FILTERS;
