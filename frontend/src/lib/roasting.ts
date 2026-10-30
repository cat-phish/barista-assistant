// Home roasting's forms and lists (docs/api/roasting-machines.md §3f,
// docs/api/green-coffees.md §4e, docs/api/roasts.md §4f): the form state as typed, its checks, and
// how much green coffee is left. Unit-tested in roasting.test.ts.
import type {
  AltitudeUnit,
  CoffeeSpecies,
  DetailedRoastLevel,
  GreenCoffee,
  GreenCoffeeInput,
  OriginArea,
  Roast,
  RoastInput,
  RoastingMachine,
  RoastingMachineInput,
  RoastLevel,
  RoastScale,
  RoastType,
  TemperatureUnit,
} from '../api/types';
import { DETAILED_ROAST_LEVELS, formatPrice } from './beans';
import { formatTime, localDateInput, parseDecimal, parseTime } from './format';
import { ROAST_LEVELS } from './scale';
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

// ---- Roasts -------------------------------------------------------------

export const MAX_WEIGHT_LOSS = 40; // %, as the API

export interface RoastForm {
  greenCoffeeId: string;
  machineId: string;
  roastedAt: string; // datetime-local, this device's time
  batchNumber: string; // blank on a new one: the next batch
  green: string; // grams in
  roasted: string; // grams out
  roastType: RoastType | '';
  detailed: DetailedRoastLevel | ''; // roast names (roastScale "names")
  level: RoastLevel | ''; // light to dark ("levels")
  chargeTemp: string; // in the person's unit
  dropTemp: string;
  firstCrack: string; // m:ss from the charge
  total: string; // m:ss, charge to drop
  restDays: string;
  notes: string;
}

const pad = (n: number) => String(n).padStart(2, '0');
// An ISO time as a datetime-local value on this device, to the minute.
export function toLocalInput(iso: string | Date): string {
  const d = new Date(iso);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// Roasting temperatures: up to 350 °C (662 °F), 1 decimal, stored in °C.
const toF = (c: number) => Math.round(((c * 9) / 5 + 32) * 10) / 10;
export function roastTempText(c: number | null, unit: TemperatureUnit): string {
  return c === null ? '' : String(unit === 'f' ? toF(c) : c);
}
export function parseRoastTemp(text: string, unit: TemperatureUnit) {
  if (unit === 'c') return parseDecimal(text, { scale: 1, min: 0, max: 350 });
  const f = parseDecimal(text, { scale: 1, min: 32, max: 662 });
  return f.ok ? { ok: true as const, value: Math.round((((f.value - 32) * 5) / 9) * 10) / 10 } : f;
}

export function roastForm(unit: TemperatureUnit, r?: Roast, defaults: { now?: Date; restDays?: number } = {}): RoastForm {
  return {
    greenCoffeeId: r?.greenCoffeeId ?? '',
    machineId: r?.machineId ?? '',
    roastedAt: toLocalInput(r?.roastedAt ?? defaults.now ?? new Date()),
    batchNumber: r?.batchNumber ?? '',
    green: r ? String(r.greenGrams) : '',
    roasted: r ? String(r.roastedGrams) : '',
    roastType: r?.roastType ?? '',
    detailed: r?.detailedRoastLevel ?? '',
    level: r?.roastLevel ?? '',
    chargeTemp: roastTempText(r?.chargeTempC ?? null, unit),
    dropTemp: roastTempText(r?.dropTempC ?? null, unit),
    firstCrack: r?.firstCrackSec != null ? formatTime(r.firstCrackSec) : '',
    total: r?.totalSec != null ? formatTime(r.totalSec) : '',
    restDays: String(r?.restDays ?? defaults.restDays ?? ''),
    notes: r?.notes ?? '',
  };
}

export function parseRoastForm(
  f: RoastForm,
  // greenOptional: editing a roast whose green coffee was deleted ('' = leave it).
  opts: { unit: TemperatureUnit; scale: RoastScale; now?: Date; greenOptional?: boolean },
): { errors: Errors; values: RoastInput | null } {
  const errors: Errors = {};
  if (!f.greenCoffeeId && !opts.greenOptional) errors.greenCoffeeId = 'Pick the green coffee';
  const at = f.roastedAt ? new Date(f.roastedAt) : null;
  if (!at || Number.isNaN(at.getTime())) errors.roastedAt = 'Required';
  else if (at.getTime() > (opts.now ?? new Date()).getTime() + 5 * 60_000) errors.roastedAt = 'Can’t be in the future';
  const weight = { scale: 0, min: 1, max: 100_000 };
  const green = f.green.trim() ? parseDecimal(f.green, weight) : null;
  const roasted = f.roasted.trim() ? parseDecimal(f.roasted, weight) : null;
  if (!green) errors.green = 'Required';
  else if (!green.ok) errors.green = green.error;
  if (!roasted) errors.roasted = 'Required';
  else if (!roasted.ok) errors.roasted = roasted.error;
  else if (green?.ok && roasted.value >= green.value) errors.roasted = 'Less than the green weight';
  else if (green?.ok && weightLoss(green.value, roasted.value) > MAX_WEIGHT_LOSS) errors.roasted = `More than ${MAX_WEIGHT_LOSS}% lost: check the weights`;
  const charge = f.chargeTemp.trim() ? parseRoastTemp(f.chargeTemp, opts.unit) : null;
  const drop = f.dropTemp.trim() ? parseRoastTemp(f.dropTemp, opts.unit) : null;
  if (charge && !charge.ok) errors.chargeTemp = charge.error;
  if (drop && !drop.ok) errors.dropTemp = drop.error;
  const time = (t: string) => {
    if (!t.trim()) return null;
    const p = parseTime(t);
    return p.ok && (p.value < 1 || p.value > 5999) ? { ok: false as const, error: 'Between 0:01 and 99:59' } : p;
  };
  const crack = time(f.firstCrack);
  const total = time(f.total);
  if (crack && !crack.ok) errors.firstCrack = crack.error;
  if (total && !total.ok) errors.total = total.error;
  else if (crack?.ok && total?.ok && crack.value >= total.value) errors.firstCrack = 'Before the end of the roast';
  const rest = parseDecimal(f.restDays, { scale: 0, min: 0, max: 60 });
  if (!rest.ok) errors.restDays = rest.error;
  if (Object.keys(errors).length || !at || !green?.ok || !roasted?.ok || !rest.ok) return { errors, values: null };

  // Light to dark keeps a roast name already recorded while its level stays chosen.
  const detailed = opts.scale === 'names' ? f.detailed || null : f.detailed && f.level === DETAILED_ROAST_LEVELS[f.detailed].roastLevel ? f.detailed : null;
  return {
    errors,
    values: {
      greenCoffeeId: f.greenCoffeeId,
      machineId: f.machineId || null,
      roastedAt: at.toISOString(),
      utcOffsetMinutes: -at.getTimezoneOffset(),
      ...(f.batchNumber.trim() ? { batchNumber: f.batchNumber.trim() } : {}),
      greenGrams: green.value,
      roastedGrams: roasted.value,
      roastType: f.roastType || null,
      detailedRoastLevel: detailed,
      // Roast names with none picked keep the level already recorded.
      roastLevel: detailed ? DETAILED_ROAST_LEVELS[detailed].roastLevel : f.level || null,
      chargeTempC: charge?.ok ? charge.value : null,
      dropTempC: drop?.ok ? drop.value : null,
      firstCrackSec: crack?.ok ? crack.value : null,
      totalSec: total?.ok ? total.value : null,
      restDays: rest.value,
      notes: text(f.notes),
    },
  };
}

// % of the green weight lost, 1 decimal, as the bean stores it.
export function weightLoss(green: number, roasted: number): number {
  return Math.round(((green - roasted) / green) * 1000) / 10;
}

// Development: from first crack to the drop, and its share of the roast.
export function development(firstCrackSec: number | null, totalSec: number | null): { sec: number; percent: number } | null {
  if (firstCrackSec === null || totalSec === null || firstCrackSec >= totalSec) return null;
  const sec = totalSec - firstCrackSec;
  return { sec, percent: Math.round((sec / totalSec) * 1000) / 10 };
}

// The local roast date (YYYY-MM-DD) and the day it's ready: that + its rest days.
export function roastDay(r: Pick<Roast, 'roastedAt' | 'utcOffsetMinutes'>): string {
  const at = new Date(r.roastedAt);
  const offset = r.utcOffsetMinutes ?? -at.getTimezoneOffset();
  return new Date(at.getTime() + offset * 60_000).toISOString().slice(0, 10);
}
export function readyOn(r: Pick<Roast, 'roastedAt' | 'utcOffsetMinutes' | 'restDays'>): string {
  const [y, m, d] = roastDay(r).split('-').map(Number);
  return new Date(Date.UTC(y!, m! - 1, d! + r.restDays)).toISOString().slice(0, 10);
}

// Roast mode → Resting (docs/roadmap.md, Home roasting): roasts still resting,
// soonest ready first; then ready ones whose bean is still in use (there,
// not archived, some left), most recently ready first.
export function restingRoasts(roasts: Roast[], today = localDateInput()): { resting: Roast[]; ready: Roast[] } {
  const dated = roasts.map((r) => ({ r, on: readyOn(r) }));
  const resting = dated.filter((d) => d.on > today).sort((a, b) => a.on.localeCompare(b.on));
  const ready = dated
    .filter((d) => d.on <= today && d.r.bean && !d.r.bean.archived && d.r.bean.inventoryWeightGrams > 0)
    .sort((a, b) => b.on.localeCompare(a.on));
  return { resting: resting.map((d) => d.r), ready: ready.map((d) => d.r) };
}

// "City+" (roast names) or "Medium" (light to dark), or null.
export function roastLevelLabel(r: Pick<Roast, 'detailedRoastLevel' | 'roastLevel'>): string | null {
  if (r.detailedRoastLevel) return DETAILED_ROAST_LEVELS[r.detailedRoastLevel].label;
  return r.roastLevel ? ROAST_LEVELS[r.roastLevel].label : null;
}
