// What "Fill in from a photo" does to the bean form (docs/api/bean-label.md
// §4d): a field that's empty is filled; one that already says something else
// gets a suggestion ("Label says: X · Use") and is left as typed.
import type { AltitudeUnit, BeanProcess, LabelFields, RoastScale } from '../api/types';
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

export function labelFill(fields: LabelFields, form: LabelForm, options: LabelFillOptions): LabelFill {
  const result: LabelFill = { fills: {}, suggestions: {} };
  const offer = (key: TextKey, value: string | null, text: string | null = value) => {
    if (value === null || value === '') return;
    if (!form[key].trim()) result.fills[key] = value;
    else if (!same(form[key], value)) result.suggestions[key] = { value, text: text ?? value };
  };

  offer('roasterName', fields.roasterName);
  offer('beanName', fields.beanName);
  const process = fields.processName
    ? options.processes.find((p) => !p.hidden && p.name.toLowerCase() === fields.processName!.toLowerCase())
    : undefined;
  if (process) offer('process', process.id, process.name);
  // A process not in the list goes in the notes, added to what's there.
  if (!process && (fields.processText ?? fields.processName)) {
    const line = `Process: ${fields.processText ?? fields.processName}`;
    if (!form.notes.toLowerCase().includes(line.toLowerCase())) offer('notes', form.notes.trim() ? `${form.notes.trimEnd()}\n${line}` : line, line);
  }
  offer('country', fields.country); // the form fills its growing area from it
  offer('region', fields.region);
  offer('producer', fields.producer);
  const altitude = altitudeText(fields.altitudeMasl, options.altitudeUnit);
  offer('altitude', altitude, altitude && `${altitude} ${ALTITUDE_LABELS[options.altitudeUnit]}`);
  offer('flavorProfile', fields.flavorProfile);
  offer('roastDate', fields.roastDate);
  // Light to dark takes either; roast names only a name.
  if (options.roastScale === 'levels') {
    const level = fields.roastLevel ?? (fields.detailedRoastLevel ? DETAILED_ROAST_LEVELS[fields.detailedRoastLevel].roastLevel : null);
    if (level) offer('roastLevel', level, ROAST_LEVELS[level].label);
  } else if (fields.detailedRoastLevel) {
    offer('roastLevel', fields.detailedRoastLevel, DETAILED_ROAST_LEVELS[fields.detailedRoastLevel].label);
  }
  if (fields.roastType) offer('roastType', fields.roastType, ROAST_TYPES[fields.roastType].label);
  if (fields.blendType) offer('blendType', fields.blendType, BLEND_TYPES[fields.blendType].label);
  if (fields.decaf && !form.decaf) result.fills.decaf = true;
  offer('bagWeight', fields.bagWeightGrams === null ? null : String(fields.bagWeightGrams), fields.bagWeightGrams === null ? null : `${fields.bagWeightGrams} g`);
  offer('batchNumber', fields.batchNumber);
  offer('website', fields.website);
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
