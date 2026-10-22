// Labels and helpers for a bean's optional details (docs/api/beans.md §4).
import type { Bean, BeanProcess, BlendType, DetailedRoastLevel, RoastLevel, RoastType } from '../api/types';

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
