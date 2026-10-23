// Editable brew details (log form and journal edit), validated with the same
// rules as the API (docs/api/brew-logs.md §6). Unit-tested in brewDraft.test.ts.
import type { BrewLogInput } from '../api/brews';
import type { BrewLog, Mark, MethodKind } from '../api/types';
import { formatGrams, formatTime, parseDecimal, parseTime } from './format';
import { parseMark } from './marks';

export interface BrewDraft {
  dose: string;
  water: string; // unused for espresso
  yieldGrams: string; // measured beverage weight: optional, but the shot weight (required) for espresso
  tds: string; // % ('' = not measured)
  temp: string;
  grinderId: string; // '' = none
  waterProfileId: string; // '' = none recorded
  firstDrop: string; // espresso: seconds, e.g. "7.4" ('' = not recorded); from the timer's tap or typed
  grind: string;
  time: string; // m:ss
  rating: number | null; // the coffee tasted on its own
  notes: string;
  drinkRating: number | null; // the finished drink (drinks with ingredients)
  drinkNotes: string;
}

export type BrewValues = Omit<BrewLogInput, 'beanId' | 'recipeId'>;
export type BrewDraftErrors = Partial<Record<'dose' | 'water' | 'yieldGrams' | 'tds' | 'temp' | 'time' | 'firstDrop', string>>;

export function emptyDraft(): BrewDraft {
  return { dose: '', water: '', yieldGrams: '', tds: '', temp: '', grinderId: '', waterProfileId: '', firstDrop: '', grind: '', time: '', rating: null, notes: '', drinkRating: null, drinkNotes: '' };
}

export function draftFromLog(log: BrewLog): BrewDraft {
  return {
    dose: formatGrams(log.actualDoseGrams),
    water: log.actualWaterGrams === null ? '' : formatGrams(log.actualWaterGrams),
    yieldGrams: log.actualYieldGrams === null ? '' : formatGrams(log.actualYieldGrams),
    tds: log.tdsPercent === null ? '' : String(log.tdsPercent),
    temp: log.actualTempC === null ? '' : String(log.actualTempC),
    grinderId: log.grinderId ?? '',
    waterProfileId: log.waterProfileId ?? '',
    firstDrop: firstDropOf(log.marks),
    grind: log.actualGrindSetting ?? '',
    time: formatTime(log.actualTimeSec),
    rating: log.rating,
    notes: log.tastingNotes ?? '',
    drinkRating: log.drinkRating,
    drinkNotes: log.drinkTastingNotes ?? '',
  };
}

// kind: the method kind of the brew's recipe (null without one). Espresso
// records the shot weight instead of water.
function firstDropOf(marks: readonly Mark[] | undefined): string {
  const at = marks?.find((m) => m.kind === 'first_drop')?.atSec;
  return at === undefined ? '' : String(at);
}

// values: the API fields; firstDropSec: the first drop for the marks list
// (espresso; null = not recorded). drinkTasting: the brew's drink has
// ingredients, so the drink's own rating and notes are sent (else null).
export function parseBrewDraft(
  d: BrewDraft,
  kind: MethodKind | null = null,
  drinkTasting = false,
): { errors: BrewDraftErrors; values: BrewValues | null; firstDropSec: number | null } {
  const espresso = kind === 'espresso';
  const dose = parseDecimal(d.dose, { scale: 2, min: 0, max: 1000, exclusiveMin: true, exclusiveMax: true });
  const grams = { scale: 2, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true };
  const water = espresso ? ({ ok: true, value: null } as const) : parseDecimal(d.water, grams);
  const yieldGrams = d.yieldGrams.trim()
    ? parseDecimal(d.yieldGrams, grams)
    : espresso
      ? ({ ok: false, error: 'Enter the shot weight' } as const)
      : null;
  const tds = d.tds.trim() ? parseDecimal(d.tds, { scale: 2, min: 0, max: 30, exclusiveMin: true }) : null;
  const temp = d.temp.trim() ? parseDecimal(d.temp, { scale: 1, min: 0, max: 100 }) : null;
  const time = parseTime(d.time);
  const firstDrop = espresso ? parseMark(d.firstDrop) : null;

  const errors: BrewDraftErrors = {};
  if (!dose.ok) errors.dose = dose.error;
  if (!water.ok) errors.water = water.error;
  if (yieldGrams && !yieldGrams.ok) errors.yieldGrams = yieldGrams.error;
  if (tds && !tds.ok) errors.tds = tds.error;
  if (temp && !temp.ok) errors.temp = temp.error;
  if (!time.ok) errors.time = time.error;
  if (firstDrop && !firstDrop.ok) errors.firstDrop = firstDrop.error;
  else if (firstDrop?.ok && time.ok && firstDrop.value > time.value) errors.firstDrop = 'After the end of the shot';
  if (Object.keys(errors).length > 0 || !dose.ok || !water.ok || (yieldGrams && !yieldGrams.ok) || !time.ok || (tds && !tds.ok) || (temp && !temp.ok)) {
    return { errors, values: null, firstDropSec: null };
  }

  return {
    errors,
    firstDropSec: firstDrop?.ok ? firstDrop.value : null,
    values: {
      actualDoseGrams: dose.value,
      actualWaterGrams: water.value,
      actualYieldGrams: yieldGrams?.ok ? yieldGrams.value : null,
      tdsPercent: tds?.ok ? tds.value : null,
      actualTempC: temp?.ok ? temp.value : null,
      grinderId: d.grinderId || null,
      waterProfileId: d.waterProfileId || null,
      actualGrindSetting: d.grind.trim() || null,
      actualTimeSec: time.value,
      rating: d.rating,
      tastingNotes: d.notes.trim() || null,
      drinkRating: drinkTasting ? d.drinkRating : null,
      drinkTastingNotes: drinkTasting ? d.drinkNotes.trim() || null : null,
    },
  };
}
