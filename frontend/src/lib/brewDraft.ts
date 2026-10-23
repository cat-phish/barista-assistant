// Editable brew details (log form and journal edit), validated with the same
// rules as the API (docs/api/brew-logs.md §6). Unit-tested in brewDraft.test.ts.
import type { BrewLogInput } from '../api/brews';
import type { BrewLog, DilutionWith, Grinder, Mark, MethodKind, SteepTemp, TemperatureUnit } from '../api/types';
import { formatGrams, formatGrind, formatTime, GRIND_SETTING, parseDecimal, parseTime } from './format';
import { parseMark } from './marks';
import { parseTemp, tempText } from './units';

export interface BrewDraft {
  dose: string;
  water: string; // unused for espresso
  yieldGrams: string; // measured beverage weight: optional, but the shot weight (required) for espresso
  tds: string; // % ('' = not measured)
  temp: string;
  grinderId: string; // '' = none
  waterProfileId: string; // '' = none recorded
  toolIds: string[]; // prep tools ticked (§3d); unticked to start
  firstDrop: string; // espresso: seconds, e.g. "7.4" ('' = not recorded); from the timer's tap or typed
  grind: string;
  rpm: string; // grinder speed ('' = not recorded); only sent for a variable-speed grinder
  beanIn: string; // g weighed before grinding ('' = not weighed)
  groundOut: string; // g out of the grinder ('' = not weighed)
  steepTemp: SteepTemp | ''; // long cold brews: fridge or room ('' = not recorded)
  dilution: string; // cold styles: served 1 : this ('' = neat / not recorded)
  dilutedWith: DilutionWith | '';
  time: string; // m:ss
  rating: number | null; // the coffee tasted on its own
  notes: string;
  drinkRating: number | null; // the finished drink (drinks with ingredients)
  drinkNotes: string;
}

export type BrewValues = Omit<BrewLogInput, 'beanId' | 'recipeId'>;
export type BrewDraftErrors = Partial<Record<'dose' | 'water' | 'yieldGrams' | 'tds' | 'temp' | 'time' | 'firstDrop' | 'rpm' | 'beanIn' | 'groundOut' | 'grind' | 'dilution', string>>;

// What the RPM is checked against: the brew's grinder (null = none chosen).
export type RpmGrinder = Pick<Grinder, 'variableSpeed' | 'rpmMin' | 'rpmMax'> | null;

export function emptyDraft(): BrewDraft {
  return { dose: '', water: '', yieldGrams: '', tds: '', temp: '', grinderId: '', waterProfileId: '', toolIds: [], firstDrop: '', grind: '', rpm: '', beanIn: '', groundOut: '', steepTemp: '', dilution: '', dilutedWith: '', time: '', rating: null, notes: '', drinkRating: null, drinkNotes: '' };
}

// temp is text in the person's unit (°C stored); see lib/units.ts.
export function draftFromLog(log: BrewLog, tempUnit: TemperatureUnit = 'c'): BrewDraft {
  return {
    dose: formatGrams(log.actualDoseGrams),
    water: log.actualWaterGrams === null ? '' : formatGrams(log.actualWaterGrams),
    yieldGrams: log.actualYieldGrams === null ? '' : formatGrams(log.actualYieldGrams),
    tds: log.tdsPercent === null ? '' : String(log.tdsPercent),
    temp: tempText(log.actualTempC, tempUnit),
    grinderId: log.grinderId ?? '',
    waterProfileId: log.waterProfileId ?? '',
    toolIds: log.tools.map((t) => t.id),
    firstDrop: firstDropOf(log.marks),
    grind: log.actualGrindSetting === null ? '' : formatGrind(log.actualGrindSetting),
    rpm: log.grindRpm === null ? '' : String(log.grindRpm),
    beanIn: log.beanWeightInGrams === null ? '' : formatGrams(log.beanWeightInGrams),
    groundOut: log.groundWeightOutGrams === null ? '' : formatGrams(log.groundWeightOutGrams),
    steepTemp: log.steepTemp ?? '',
    dilution: log.dilutionRatio === null ? '' : String(log.dilutionRatio),
    dilutedWith: log.dilutedWith ?? '',
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
// grinder: the RPM is only sent for a variable-speed one, within its range.
export function parseBrewDraft(
  d: BrewDraft,
  kind: MethodKind | null = null,
  drinkTasting = false,
  tempUnit: TemperatureUnit = 'c',
  grinder: RpmGrinder = null,
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
  const temp = d.temp.trim() ? parseTemp(d.temp, tempUnit) : null;
  const time = parseTime(d.time);
  const firstDrop = espresso ? parseMark(d.firstDrop) : null;
  const grind = d.grind.trim() ? parseDecimal(d.grind, GRIND_SETTING) : null;
  const dilution = d.dilution.trim() ? parseDecimal(d.dilution, { scale: 1, min: 0, max: 10, exclusiveMin: true }) : null;
  const weight = { scale: 2, min: 0, max: 1000, exclusiveMin: true, exclusiveMax: true };
  const beanIn = d.beanIn.trim() ? parseDecimal(d.beanIn, weight) : null;
  const groundOut = d.groundOut.trim() ? parseDecimal(d.groundOut, weight) : null;
  const rpm = grinder?.variableSpeed && d.rpm.trim() ? parseDecimal(d.rpm, { scale: 0, min: 50, max: 5000 }) : null;

  const errors: BrewDraftErrors = {};
  if (!dose.ok) errors.dose = dose.error;
  if (!water.ok) errors.water = water.error;
  if (yieldGrams && !yieldGrams.ok) errors.yieldGrams = yieldGrams.error;
  if (tds && !tds.ok) errors.tds = tds.error;
  if (temp && !temp.ok) errors.temp = temp.error;
  if (!time.ok) errors.time = time.error;
  if (firstDrop && !firstDrop.ok) errors.firstDrop = firstDrop.error;
  else if (firstDrop?.ok && time.ok && firstDrop.value > time.value) errors.firstDrop = 'After the end of the shot';
  if (grind && !grind.ok) errors.grind = grind.error;
  if (dilution && !dilution.ok) errors.dilution = dilution.error;
  if (beanIn && !beanIn.ok) errors.beanIn = beanIn.error;
  if (groundOut && !groundOut.ok) errors.groundOut = groundOut.error;
  else if (groundOut?.ok && beanIn?.ok && groundOut.value > beanIn.value) errors.groundOut = 'More than the beans weighed in';
  if (rpm && !rpm.ok) errors.rpm = rpm.error;
  else if (rpm?.ok && grinder?.rpmMin != null && grinder.rpmMax != null && (rpm.value < grinder.rpmMin || rpm.value > grinder.rpmMax)) {
    errors.rpm = `Outside the grinder's range (${grinder.rpmMin}–${grinder.rpmMax})`;
  }
  if (Object.keys(errors).length > 0 || !dose.ok || !water.ok || (yieldGrams && !yieldGrams.ok) || !time.ok || (tds && !tds.ok) || (temp && !temp.ok) || (rpm && !rpm.ok) || (beanIn && !beanIn.ok) || (groundOut && !groundOut.ok) || (grind && !grind.ok) || (dilution && !dilution.ok)) {
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
      toolIds: [...d.toolIds],
      actualGrindSetting: grind?.ok ? grind.value : null,
      grindRpm: rpm?.ok ? rpm.value : null,
      beanWeightInGrams: beanIn?.ok ? beanIn.value : null,
      groundWeightOutGrams: groundOut?.ok ? groundOut.value : null,
      steepTemp: d.steepTemp || null,
      dilutionRatio: dilution?.ok ? dilution.value : null,
      dilutedWith: dilution?.ok ? d.dilutedWith || null : null,
      actualTimeSec: time.value,
      rating: d.rating,
      tastingNotes: d.notes.trim() || null,
      drinkRating: drinkTasting ? d.drinkRating : null,
      drinkTastingNotes: drinkTasting ? d.drinkNotes.trim() || null : null,
    },
  };
}
