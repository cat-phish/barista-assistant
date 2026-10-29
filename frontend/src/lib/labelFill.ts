// What "Fill in from a photo" does to the bean form (docs/api/bean-label.md
// §4d): a field that's empty is filled; one that already says something else
// gets a suggestion ("Label says: X · Use") and is left as typed.
import type { AltitudeUnit, BeanProcess, LabelFields, LabelLookUp, LabelWebFinds, RoastScale } from '../api/types';
import { BLEND_TYPES, DETAILED_ROAST_LEVELS, ROAST_TYPES } from './beans';
import { ROAST_LEVELS } from './scale';
import { ALTITUDE_LABELS, altitudeText } from './units';

// The form's values the label can fill, as the form holds them (text, ids
// and keys; '' is empty). roastLevel is a 5-step key with roastScale
// "levels", else a roast name key.
export interface LabelForm {
  roasterName: string;
  beanName: string;
  process: string;
  country: string;
  region: string;
  producer: string;
  altitude: string;
  flavorProfile: string;
  roastDate: string;
  roastLevel: string;
  roastType: string;
  blendType: string;
  decaf: boolean;
  bagWeight: string;
  batchNumber: string;
  website: string;
  notes: string;
}
export type TextKey = Exclude<keyof LabelForm, 'decaf'>;

export interface LabelSuggestion {
  value: string; // what Use puts in the field
  text: string; // what the label says, as shown
  source?: string; // from the web: the page it's on
}

export interface LabelFill {
  fills: Partial<LabelForm>;
  suggestions: Partial<Record<TextKey, LabelSuggestion>>;
}

// The Settings → Fields key that hides each (lib/fields.ts); null: always shown.
export const LABEL_FIELD_KEYS: Record<keyof LabelForm, string | null> = {
  roasterName: null,
  beanName: null,
  process: 'bean.process',
  country: 'bean.origin',
  region: 'bean.region',
  producer: 'bean.producer',
  altitude: 'bean.altitude',
  flavorProfile: 'bean.flavorProfile',
  roastDate: 'bean.roastDate',
  roastLevel: 'bean.roastLevel',
  roastType: 'bean.roastType',
  blendType: 'bean.blendType',
  decaf: 'bean.decaf',
  bagWeight: 'bean.bagWeight',
  batchNumber: 'bean.batchNumber',
  website: 'bean.website',
  notes: 'bean.notes',
};

const same = (a: string, b: string) => {
  const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\/$/, '');
  return norm(a) === norm(b);
};

export interface LabelFillOptions {
  processes: BeanProcess[]; // the workspace's (hidden ones are skipped)
  altitudeUnit: AltitudeUnit;
  roastScale: RoastScale;
}

// One value the label (or web) gives a form field: what Use puts in, how
// it's shown, and the LabelFields key it came from (for its web source).
interface Offer {
  key: TextKey;
  value: string;
  text: string;
  from: keyof LabelFields;
}
function offers(fields: Partial<LabelFields>, form: LabelForm, options: LabelFillOptions): Offer[] {
  const out: Offer[] = [];
  const offer = (key: TextKey, from: keyof LabelFields, value: string | null | undefined, text: string | null | undefined = value) => {
    if (value) out.push({ key, value, text: text || value, from });
  };
  offer('roasterName', 'roasterName', fields.roasterName);
  offer('beanName', 'beanName', fields.beanName);
  const process = fields.processName
    ? options.processes.find((p) => !p.hidden && p.name.toLowerCase() === fields.processName!.toLowerCase())
    : undefined;
  if (process) offer('process', 'processName', process.id, process.name);
  // A process not in the list goes in the notes, added to what's there.
  const printed = fields.processText ?? fields.processName;
  if (!process && printed) {
    const line = `Process: ${printed}`;
    if (!form.notes.toLowerCase().includes(line.toLowerCase())) {
      offer('notes', fields.processText ? 'processText' : 'processName', form.notes.trim() ? `${form.notes.trimEnd()}\n${line}` : line, line);
    }
  }
  offer('country', 'country', fields.country); // the form fills its growing area from it
  offer('region', 'region', fields.region);
  offer('producer', 'producer', fields.producer);
  const altitude = altitudeText(fields.altitudeMasl ?? null, options.altitudeUnit);
  offer('altitude', 'altitudeMasl', altitude, altitude && `${altitude} ${ALTITUDE_LABELS[options.altitudeUnit]}`);
  offer('flavorProfile', 'flavorProfile', fields.flavorProfile);
  offer('roastDate', 'roastDate', fields.roastDate);
  // Light to dark takes either; roast names only a name.
  if (options.roastScale === 'levels') {
    const level = fields.roastLevel ?? (fields.detailedRoastLevel ? DETAILED_ROAST_LEVELS[fields.detailedRoastLevel].roastLevel : null);
    if (level) offer('roastLevel', fields.roastLevel ? 'roastLevel' : 'detailedRoastLevel', level, ROAST_LEVELS[level].label);
  } else if (fields.detailedRoastLevel) {
    offer('roastLevel', 'detailedRoastLevel', fields.detailedRoastLevel, DETAILED_ROAST_LEVELS[fields.detailedRoastLevel].label);
  }
  if (fields.roastType) offer('roastType', 'roastType', fields.roastType, ROAST_TYPES[fields.roastType].label);
  if (fields.blendType) offer('blendType', 'blendType', fields.blendType, BLEND_TYPES[fields.blendType].label);
  const bag = fields.bagWeightGrams ?? null;
  offer('bagWeight', 'bagWeightGrams', bag === null ? null : String(bag), bag === null ? null : `${bag} g`);
  offer('batchNumber', 'batchNumber', fields.batchNumber);
  offer('website', 'website', fields.website);
  return out;
}

// The label fills empty fields and suggests for the rest. What the web
// found (bean-label.md §4d) is only ever suggested, with its page, and not
// where it says what the form (after the label) already says, or where the
// label already made a suggestion.
export function labelFill(fields: LabelFields, form: LabelForm, options: LabelFillOptions, web: LabelWebFinds | null = null): LabelFill {
  const result: LabelFill = { fills: {}, suggestions: {} };
  for (const o of offers(fields, form, options)) {
    if (!form[o.key].trim()) result.fills[o.key] = o.value;
    else if (!same(form[o.key], o.value)) result.suggestions[o.key] = { value: o.value, text: o.text };
  }
  if (fields.decaf && !form.decaf) result.fills.decaf = true;
  if (!web) return result;

  const after: LabelForm = { ...form, ...result.fills };
  const values: Partial<LabelFields> = Object.fromEntries(Object.entries(web).map(([field, find]) => [field, find.value]));
  const sourceOf = (from: keyof LabelFields) => (web as Partial<Record<keyof LabelFields, { url: string }>>)[from]?.url;
  for (const o of offers(values, after, options)) {
    const source = sourceOf(o.from);
    if (!source || result.suggestions[o.key] || same(after[o.key], o.value)) continue;
    result.suggestions[o.key] = { value: o.value, text: o.text, source };
  }
  return result;
}

// The photos one read sends (LABEL_MAX_IMAGES in @barista/shared/jobs): ones
// taken just for it first, then the bean's, cover first. left: how many
// didn't fit.
export const LABEL_MAX_IMAGES = 8;
export function labelImages<T>(extras: readonly T[], beanPhotos: readonly T[], max = LABEL_MAX_IMAGES): { images: T[]; left: number } {
  const all = [...extras, ...beanPhotos];
  return { images: all.slice(0, max), left: Math.max(0, all.length - max) };
}

// A page the web lookup looked at, short enough to list: host (no www.) and
// path, "onyxcoffeelab.com/products/geometry"; the home page is just the host.
export function pageLabel(address: string): string {
  try {
    const url = new URL(address);
    const path = decodeURI(url.pathname).replace(/\/+$/, '');
    return `${url.hostname.replace(/^www\./, '')}${path}`;
  } catch {
    return address;
  }
}

// What a web lookup is given (docs/api/bean-label.md §4d): what's known of
// the bean, blanks left out, never one bag's roast date or batch number.
// After a label read, the form's website stands in when the label has none.
export function lookUpFields(fields: Partial<LabelFields>, website = ''): LabelLookUp {
  const { roastDate: _date, batchNumber: _batch, ...rest } = fields;
  const known = Object.fromEntries(
    Object.entries(rest).filter(([, v]) => v !== null && v !== undefined && (typeof v !== 'string' || v.trim() !== '')),
  ) as LabelLookUp;
  if (!known.website && website.trim()) known.website = website.trim();
  return known;
}
// The lookup needs a name to search for.
export const canLookUp = (fields: LabelLookUp): boolean => !!(fields.roasterName || fields.beanName);
