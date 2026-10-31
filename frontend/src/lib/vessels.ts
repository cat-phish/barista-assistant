// The vessel form (docs/api/vessels.md §3g): the state as typed and its
// checks. Unit-tested in vessels.test.ts.
import type { Vessel, VesselInput } from '../api/types';
import { formatGrams, parseDecimal } from './format';

export interface VesselForm {
  name: string;
  weight: string; // grams
}
export function vesselForm(v?: Vessel): VesselForm {
  return { name: v?.name ?? '', weight: v ? formatGrams(v.weightGrams) : '' };
}
export function parseVesselForm(f: VesselForm): { errors: Partial<Record<keyof VesselForm, string>>; values: VesselInput | null } {
  const errors: Partial<Record<keyof VesselForm, string>> = {};
  if (!f.name.trim()) errors.name = 'Required';
  const weight = parseDecimal(f.weight, { scale: 2, min: 0, max: 10000, exclusiveMin: true, exclusiveMax: true });
  if (!weight.ok) errors.weight = weight.error;
  if (!weight.ok || errors.name) return { errors, values: null };
  return { errors, values: { name: f.name.trim(), weightGrams: weight.value } };
}
