// Editable brew details (log form and journal edit), validated with the same
// rules as the API (docs/api_spec.md §6). Unit-tested in brewDraft.test.ts.
import type { BrewLogInput } from '../api/brews';
import type { BrewLog } from '../api/types';
import { formatGrams, formatTime, parseDecimal, parseTime } from './format';

export interface BrewDraft {
  dose: string;
  water: string;
  yieldGrams: string; // measured beverage weight, optional
  temp: string;
  grinderId: string; // '' = none
  grind: string;
  time: string; // m:ss
  rating: number | null;
  notes: string;
}

export type BrewValues = Omit<BrewLogInput, 'beanId' | 'recipeId'>;
export type BrewDraftErrors = Partial<Record<'dose' | 'water' | 'yieldGrams' | 'temp' | 'time', string>>;

export function emptyDraft(): BrewDraft {
  return { dose: '', water: '', yieldGrams: '', temp: '', grinderId: '', grind: '', time: '', rating: null, notes: '' };
}

export function draftFromLog(log: BrewLog): BrewDraft {
  return {
    dose: formatGrams(log.actualDoseGrams),
    water: formatGrams(log.actualWaterGrams),
    yieldGrams: log.actualYieldGrams === null ? '' : formatGrams(log.actualYieldGrams),
    temp: log.actualTempC === null ? '' : String(log.actualTempC),
    grinderId: log.grinderId ?? '',
    grind: log.actualGrindSetting ?? '',
    time: formatTime(log.actualTimeSec),
    rating: log.rating,
    notes: log.tastingNotes ?? '',
  };
}

export function parseBrewDraft(d: BrewDraft): { errors: BrewDraftErrors; values: BrewValues | null } {
  const dose = parseDecimal(d.dose, { scale: 2, min: 0, max: 1000, exclusiveMin: true, exclusiveMax: true });
  const grams = { scale: 2, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true };
  const water = parseDecimal(d.water, grams);
  const yieldGrams = d.yieldGrams.trim() ? parseDecimal(d.yieldGrams, grams) : null;
  const temp = d.temp.trim() ? parseDecimal(d.temp, { scale: 1, min: 0, max: 100 }) : null;
  const time = parseTime(d.time);

  const errors: BrewDraftErrors = {};
  if (!dose.ok) errors.dose = dose.error;
  if (!water.ok) errors.water = water.error;
  if (yieldGrams && !yieldGrams.ok) errors.yieldGrams = yieldGrams.error;
  if (temp && !temp.ok) errors.temp = temp.error;
  if (!time.ok) errors.time = time.error;
  if (!dose.ok || !water.ok || (yieldGrams && !yieldGrams.ok) || !time.ok || (temp && !temp.ok)) return { errors, values: null };

  return {
    errors,
    values: {
      actualDoseGrams: dose.value,
      actualWaterGrams: water.value,
      actualYieldGrams: yieldGrams?.ok ? yieldGrams.value : null,
      actualTempC: temp?.ok ? temp.value : null,
      grinderId: d.grinderId || null,
      actualGrindSetting: d.grind.trim() || null,
      actualTimeSec: time.value,
      rating: d.rating,
      tastingNotes: d.notes.trim() || null,
    },
  };
}
