// The Log a serving form (docs/api/brew-servings.md §6c): typed text in,
// the API's values out. Dilution normally happens in the glass; a jar
// diluted as a whole (jarWaterGrams) is poured ready to drink.
import type { BrewServingInput } from '../api/servings';
import type { BrewServing, DilutionWith } from '../api/types';
import { DILUTION_WITH } from './coldBrew';
import { formatGrams, parseDecimal } from './format';
import { toLocalInput } from './roasting';

export interface ServingDraft {
  poured: string; // g from the jar
  water: string; // g added in the glass
  dilutedWith: DilutionWith;
  when: string; // datetime-local, this device's time
  rating: number | null;
  flavors: string[];
  notes: string;
  batchYield: string; // an unweighed batch's concentrate made, g ('' = leave it)
}
export type ServingDraftErrors = Partial<Record<'poured' | 'water' | 'when' | 'batchYield', string>>;

export function emptyServingDraft(now: Date = new Date()): ServingDraft {
  return { poured: '', water: '', dilutedWith: 'water', when: toLocalInput(now), rating: null, flavors: [], notes: '', batchYield: '' };
}

export function servingDraftFrom(s: BrewServing): ServingDraft {
  return {
    poured: formatGrams(s.concentrateGrams),
    water: s.diluentGrams ? formatGrams(s.diluentGrams) : '',
    dilutedWith: s.dilutedWith ?? 'water',
    when: toLocalInput(s.timestamp),
    rating: s.rating,
    flavors: s.flavors.map((f) => f.key),
    notes: s.tastingNotes ?? '',
    batchYield: '',
  };
}

const GRAMS = { scale: 1, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true };
const FUTURE_SKEW_MS = 5 * 60 * 1000; // as the API

export function parseServingDraft(
  d: ServingDraft,
  now: Date = new Date(),
): { values: BrewServingInput | null; batchYieldGrams: number | null; errors: ServingDraftErrors } {
  const errors: ServingDraftErrors = {};
  const poured = d.poured.trim() ? parseDecimal(d.poured, GRAMS) : null;
  if (!poured) errors.poured = 'How much you poured';
  else if (!poured.ok) errors.poured = poured.error;
  const water = d.water.trim() ? parseDecimal(d.water, { ...GRAMS, exclusiveMin: false }) : null;
  if (water && !water.ok) errors.water = water.error;
  const at = new Date(d.when);
  if (!d.when || Number.isNaN(at.getTime())) errors.when = 'When you poured it';
  else if (at.getTime() > now.getTime() + FUTURE_SKEW_MS) errors.when = "Can't be in the future";
  const batchYield = d.batchYield.trim() ? parseDecimal(d.batchYield, GRAMS) : null;
  if (batchYield && !batchYield.ok) errors.batchYield = batchYield.error;
  if (Object.keys(errors).length > 0 || !poured?.ok) return { values: null, batchYieldGrams: null, errors };
  const waterGrams = water?.ok ? water.value : null;
  return {
    values: {
      concentrateGrams: poured.value,
      diluentGrams: waterGrams,
      dilutedWith: waterGrams ? d.dilutedWith : null,
      timestamp: at.toISOString(),
      utcOffsetMinutes: -at.getTimezoneOffset(),
      rating: d.rating,
      tastingNotes: d.notes.trim() || null,
      flavors: [...d.flavors],
    },
    batchYieldGrams: batchYield?.ok ? batchYield.value : null,
    errors,
  };
}

// The glass's water to start from: the batch's served dilution × what's
// poured. Nothing when the jar was diluted already, or with no figure.
export function suggestWater(pouredGrams: number | null, servedRatio: number | null, jarDiluted: boolean): string {
  if (jarDiluted || !servedRatio || !pouredGrams || !(pouredGrams > 0)) return '';
  return formatGrams(Math.round(pouredGrams * servedRatio));
}

// "1 : 1.5", or "neat".
export const ratioText = (ratio: number | null): string => (ratio === null ? 'neat' : `1 : ${Number(ratio.toFixed(2))}`);

// "120 g + 120 g water", "240 g".
export function servingAmounts(s: Pick<BrewServing, 'concentrateGrams' | 'diluentGrams' | 'dilutedWith'>): string {
  const added = s.diluentGrams ? ` + ${formatGrams(s.diluentGrams)} g ${DILUTION_WITH[s.dilutedWith ?? 'water']}` : '';
  return `${formatGrams(s.concentrateGrams)} g${added}`;
}
