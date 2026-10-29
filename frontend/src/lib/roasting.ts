// Home roasting's forms and lists (docs/api/roasting-machines.md §3f,
// docs/api/green-coffees.md §4e): the form state as typed, its checks, and
// how much green coffee is left. Unit-tested in roasting.test.ts.
import type { AltitudeUnit, CoffeeSpecies, GreenCoffee, GreenCoffeeInput, OriginArea, RoastingMachine, RoastingMachineInput } from '../api/types';
import { formatPrice } from './beans';
import { localDateInput, parseDecimal } from './format';
import { altitudeText, parseAltitude } from './units';

type Errors = Partial<Record<string, string>>;
const optional = (text: string, opts: Parameters<typeof parseDecimal>[1]) => (text.trim() ? parseDecimal(text, opts) : null);
const text = (s: string) => s.trim() || null;

// ---- Roasting machines --------------------------------------------------

export interface MachineForm {
  name: string;
  notes: string;
  capacity: string; // grams
}
export function machineForm(m?: RoastingMachine): MachineForm {
  return { name: m?.name ?? '', notes: m?.notes ?? '', capacity: m?.capacityGrams != null ? String(m.capacityGrams) : '' };
}
export function parseMachineForm(f: MachineForm): { errors: Errors; values: RoastingMachineInput | null } {
  const errors: Errors = {};
  if (!f.name.trim()) errors.name = 'Required';
  const capacity = optional(f.capacity, { scale: 0, min: 1, max: 100_000 });
  if (capacity && !capacity.ok) errors.capacity = capacity.error;
  if (Object.keys(errors).length) return { errors, values: null };
  return { errors, values: { name: f.name.trim(), notes: text(f.notes), capacityGrams: capacity?.ok ? capacity.value : null } };
}

// ---- Green coffees ------------------------------------------------------

export interface GreenForm {
  name: string;
  processId: string;
  originArea: OriginArea | '';
  country: string;
  region: string;
  producer: string;
  altitude: string; // in the person's altitude unit
  varieties: string[];
  species: CoffeeSpecies[];
  supplier: string;
  lot: string;
  price: string;
  currency: string;
  bought: string; // grams
  left: string; // grams; blank on a new one = what was bought
  lowStock: string; // grams
  purchaseDate: string; // YYYY-MM-DD
  notes: string;
}

export function greenForm(altitudeUnit: AltitudeUnit, g?: GreenCoffee, currency = ''): GreenForm {
  const grams = (n: number | null | undefined) => (n != null ? String(n) : '');
  return {
    name: g?.name ?? '',
    processId: g?.processId ?? '',
    originArea: g?.originArea ?? '',
    country: g?.country ?? '',
    region: g?.region ?? '',
    producer: g?.producer ?? '',
    altitude: altitudeText(g?.altitudeMasl ?? null, altitudeUnit),
    varieties: g?.varieties ?? [],
    species: g?.species ?? [],
    supplier: g?.supplier ?? '',
    lot: g?.lot ?? '',
    price: g?.priceAmount != null ? g.priceAmount.toFixed(2) : '',
    currency: g ? (g.priceCurrency ?? '') : currency,
    bought: grams(g?.weightBoughtGrams),
    left: grams(g?.weightLeftGrams),
    lowStock: grams(g?.lowStockGrams),
    purchaseDate: g?.purchaseDate ?? '',
    notes: g?.notes ?? '',
  };
}

export function parseGreenForm(f: GreenForm, altitudeUnit: AltitudeUnit, today = localDateInput()): { errors: Errors; values: GreenCoffeeInput | null } {
  const errors: Errors = {};
  if (!f.name.trim()) errors.name = 'Required';
  const altitude = f.altitude.trim() ? parseAltitude(f.altitude, altitudeUnit) : null;
  if (altitude && !altitude.ok) errors.altitude = altitude.error;
  const price = optional(f.price, { scale: 2, min: 0, max: 1_000_000, exclusiveMin: true, exclusiveMax: true });
  const currency = f.currency.trim().toUpperCase();
  if (price && !price.ok) errors.price = price.error;
  // Without a price the currency (often prefilled) is ignored, not an error.
  else if (price && !/^[A-Z]{3}$/.test(currency)) errors.currency = currency ? 'A 3-letter code, e.g. USD' : 'Needed with a price';
  const grams = { scale: 0, min: 0, max: 1_000_000 };
  const bought = optional(f.bought, { ...grams, min: 1 });
  const left = optional(f.left, grams);
  const low = optional(f.lowStock, { ...grams, min: 1 });
  if (bought && !bought.ok) errors.bought = bought.error;
  if (left && !left.ok) errors.left = left.error;
  if (low && !low.ok) errors.lowStock = low.error;
  if (f.purchaseDate && f.purchaseDate > today) errors.purchaseDate = 'Can’t be in the future';
  if (Object.keys(errors).length) return { errors, values: null };
  const boughtGrams = bought?.ok ? bought.value : null;
  return {
    errors,
    values: {
      name: f.name.trim(),
      processId: f.processId || null,
      originArea: f.originArea || null,
      country: text(f.country),
      region: text(f.region),
      producer: text(f.producer),
      altitudeMasl: altitude?.ok ? altitude.value : null,
      varieties: f.varieties.length ? f.varieties : null,
      species: f.species.length ? f.species : null,
      supplier: text(f.supplier),
      lot: text(f.lot),
      priceAmount: price?.ok ? price.value : null,
      priceCurrency: price?.ok ? currency : null,
      weightBoughtGrams: boughtGrams,
      weightLeftGrams: left?.ok ? left.value : (boughtGrams ?? 0),
      lowStockGrams: low?.ok ? low.value : null,
      purchaseDate: f.purchaseDate || null,
      notes: text(f.notes),
    },
  };
}

// How much is left: none, under its threshold, or fine; and the share of
// what was bought, when that's known.
export type StockState = 'out' | 'low' | 'ok';
export function greenStock(g: Pick<GreenCoffee, 'weightLeftGrams' | 'weightBoughtGrams' | 'lowStockGrams'>): { state: StockState; percent: number | null } {
  const state: StockState = g.weightLeftGrams <= 0 ? 'out' : g.lowStockGrams !== null && g.weightLeftGrams < g.lowStockGrams ? 'low' : 'ok';
  const percent = g.weightBoughtGrams ? Math.min(100, Math.round((g.weightLeftGrams / g.weightBoughtGrams) * 100)) : null;
  return { state, percent };
}

// "1.8 kg" from a kilo, else grams: green coffee comes by the kilo or pound.
export function formatStock(grams: number): string {
  return grams >= 1000 ? `${Number((grams / 1000).toFixed(2))} kg` : `${grams} g`;
}

// "42.50 USD · 1.87 USD/100 g": the purchase and what 100 g of it cost.
export function greenPrice(g: Pick<GreenCoffee, 'priceAmount' | 'priceCurrency' | 'weightBoughtGrams'>): string | null {
  if (g.priceAmount === null || g.priceCurrency === null) return null;
  const total = formatPrice(g.priceAmount, g.priceCurrency);
  return g.weightBoughtGrams ? `${total} · ${((g.priceAmount / g.weightBoughtGrams) * 100).toFixed(2)} ${g.priceCurrency}/100 g` : total;
}
