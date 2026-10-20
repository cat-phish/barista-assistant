// Drink sizes (docs/api_spec.md §5c): a drink's component amounts are for its
// default size; brewing a different size scales them (and a filter method's
// batch) by the ratio of the two sizes.
import type { Drink, ServingUnit } from '../api/types';
import { formatGrams } from './format';
import { GRAMS_PER_FL_OZ } from './scale';

export const SERVING_UNITS: Record<ServingUnit, string> = { fl_oz: 'fl oz', ml: 'ml' };
// Offered first for component amounts; anything else is typed and remembered.
export const BUILT_IN_UNITS = ['fl oz', 'ml', 'g'] as const;

export interface Size {
  size: number;
  unit: ServingUnit;
}

export const toMl = (s: Size) => (s.unit === 'fl_oz' ? s.size * GRAMS_PER_FL_OZ : s.size);

// The drink's default size, if it has one.
export function defaultSize(d: Pick<Drink, 'servingSize' | 'servingUnit'> | null): Size | null {
  return d && d.servingSize !== null && d.servingUnit !== null ? { size: d.servingSize, unit: d.servingUnit } : null;
}

// How much bigger the size made is than the default (1 = as written).
export function sizeFactor(made: Size | null, base: Size | null): number {
  if (!made || !base || !(made.size > 0) || !(base.size > 0)) return 1;
  const f = toMl(made) / toMl(base);
  return Math.abs(f - 1) < 1e-9 ? 1 : f;
}

// The same size in another unit: 8 fl oz -> 237 ml, 350 ml -> 11.8 fl oz.
export function convertSize(s: Size, unit: ServingUnit): Size {
  if (s.unit === unit) return s;
  const ml = toMl(s);
  return unit === 'ml' ? { size: Math.round(ml), unit } : { size: Math.round((ml / GRAMS_PER_FL_OZ) * 10) / 10, unit };
}

// Scaled amounts are rounded so they can be measured: whole ml and g, 0.1 fl
// oz, and halves of anything else (pumps, spoons). As written, nothing changes.
export function scaleAmount(value: number, unit: string | null, factor: number): number {
  if (factor === 1) return value;
  const exact = value * factor;
  const step = unit === 'ml' || unit === 'g' ? 1 : unit === 'fl oz' ? 0.1 : 0.5;
  const rounded = Math.round(exact / step) * step;
  return rounded > 0 ? Number(rounded.toFixed(2)) : Number(exact.toFixed(2));
}

// "2.5 pump", "6 fl oz", "to taste", or null when there's no amount.
export function formatAmount(value: number | null, unit: string | null, factor = 1): string | null {
  if (value === null) return unit;
  const n = formatGrams(scaleAmount(value, unit, factor));
  return unit ? `${n} ${unit}` : n;
}

export function formatSize(s: Size): string {
  return `${formatGrams(s.size)} ${SERVING_UNITS[s.unit]}`;
}

// Unit suggestions: the built-in ones, then every other unit the workspace's
// drinks use (case-insensitively deduplicated, by name).
export function knownUnits(drinks: Drink[]): string[] {
  const seen = new Set<string>(BUILT_IN_UNITS.map((u) => u.toLowerCase()));
  const extra: string[] = [];
  for (const d of drinks) {
    for (const c of d.components) {
      const u = c.amountUnit?.trim();
      if (u && !seen.has(u.toLowerCase())) {
        seen.add(u.toLowerCase());
        extra.push(u);
      }
    }
  }
  return [...BUILT_IN_UNITS, ...extra.sort((a, b) => a.localeCompare(b))];
}
