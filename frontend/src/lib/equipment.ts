// Labels and one-line summaries for equipment (docs/api_spec.md §3, §3b).
import type { Brewer, BurrType, Grinder, GrinderAdjustment, GrinderDetails, GrinderPower, MachineCapabilities, MethodKind, Preinfusion, ProfileControl } from '../api/types';
import { formatGrams, parseDecimal } from './format';

export const METHOD_KINDS: Record<MethodKind, { label: string; hint: string }> = {
  pour_over: { label: 'Pour over', hint: 'Water poured over the bed: V60, Kalita, Chemex' },
  immersion: { label: 'Immersion', hint: 'Steeped, then pressed or drained: AeroPress, French press' },
  espresso: { label: 'Espresso', hint: 'Dose and shot weight instead of water' },
};

export const GRINDER_ADJUSTMENTS: Record<GrinderAdjustment, string> = { stepped: 'Stepped (clicks)', stepless: 'Stepless' };
export const BURR_TYPES: Record<BurrType, string> = { conical: 'Conical', flat: 'Flat' };
export const GRINDER_POWER: Record<GrinderPower, string> = { manual: 'Hand grinder', electric: 'Electric' };

export const PREINFUSION_MODES: Record<Preinfusion, { label: string; hint: string }> = {
  none: { label: 'None', hint: 'Full pressure from the start' },
  automatic: { label: 'Automatic', hint: 'The machine pre-infuses on its own' },
  manual: { label: 'Manual', hint: 'You control it: paddle, lever or button' },
};
export const PROFILE_CONTROLS: Record<ProfileControl, { label: string; hint: string }> = {
  none: { label: 'None', hint: 'Fixed by the machine' },
  manual: { label: 'Manual', hint: 'By hand while pulling: paddle, lever, needle valve' },
  programmable: { label: 'Programmable', hint: 'Saved profiles' },
};

// "Stepped · 0–40, 1 per step · Conical 39 mm · Hand grinder"
export function grinderSummary(g: Grinder): string {
  const parts: string[] = [];
  if (g.adjustment) parts.push(g.adjustment === 'stepped' ? 'Stepped' : 'Stepless');
  if (g.settingMin !== null && g.settingMax !== null) {
    parts.push(`${formatGrams(g.settingMin)}–${formatGrams(g.settingMax)}${g.stepSize !== null ? `, ${formatGrams(g.stepSize)} per step` : ''}`);
  } else if (g.stepSize !== null) parts.push(`${formatGrams(g.stepSize)} per step`);
  if (g.burrType || g.burrSizeMm !== null) parts.push([g.burrType ? BURR_TYPES[g.burrType] : 'Burrs', g.burrSizeMm !== null ? `${g.burrSizeMm} mm` : ''].filter(Boolean).join(' '));
  if (g.power) parts.push(GRINDER_POWER[g.power]);
  return parts.join(' · ');
}

// "Pre-infusion: manual · Flow: manual" (capabilities that aren't "none").
export function machineSummary(m: MachineCapabilities): string {
  const parts = [
    m.preinfusion !== 'none' ? `Pre-infusion: ${PREINFUSION_MODES[m.preinfusion].label.toLowerCase()}` : '',
    m.flowControl !== 'none' ? `Flow: ${PROFILE_CONTROLS[m.flowControl].label.toLowerCase()}` : '',
    m.pressureControl !== 'none' ? `Pressure: ${PROFILE_CONTROLS[m.pressureControl].label.toLowerCase()}` : '',
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : 'No pre-infusion, flow or pressure control';
}

// Grinder add/edit form: text inputs, validated like the API (§3b).
export interface GrinderForm {
  name: string;
  notes: string;
  adjustment: GrinderAdjustment | '';
  settingMin: string;
  settingMax: string;
  stepSize: string;
  burrType: BurrType | '';
  burrSizeMm: string;
  power: GrinderPower | '';
}
export type GrinderFormErrors = Partial<Record<'name' | 'range' | 'stepSize' | 'burrSizeMm', string>>;

export function grinderForm(g?: Grinder): GrinderForm {
  const num = (n: number | null | undefined) => (n == null ? '' : formatGrams(n));
  return {
    name: g?.name ?? '',
    notes: g?.notes ?? '',
    adjustment: g?.adjustment ?? '',
    settingMin: num(g?.settingMin),
    settingMax: num(g?.settingMax),
    stepSize: num(g?.stepSize),
    burrType: g?.burrType ?? '',
    burrSizeMm: g?.burrSizeMm == null ? '' : String(g.burrSizeMm),
    power: g?.power ?? '',
  };
}

export function parseGrinderForm(f: GrinderForm): { errors: GrinderFormErrors; values: (GrinderDetails & { name: string }) | null } {
  const errors: GrinderFormErrors = {};
  if (!f.name.trim()) errors.name = 'Required';
  const optional = (text: string, opts: Parameters<typeof parseDecimal>[1]) => (text.trim() ? parseDecimal(text, opts) : null);
  const setting = { scale: 2, min: 0, max: 10000, exclusiveMax: true };
  const min = optional(f.settingMin, setting);
  const max = optional(f.settingMax, setting);
  const step = optional(f.stepSize, { scale: 2, min: 0, max: 1000, exclusiveMin: true, exclusiveMax: true });
  const burr = optional(f.burrSizeMm, { scale: 0, min: 10, max: 200 });
  if (min && !min.ok) errors.range = `From: ${min.error}`;
  else if (max && !max.ok) errors.range = `To: ${max.error}`;
  else if (!min !== !max) errors.range = 'Enter both ends of the range, or neither';
  else if (min?.ok && max?.ok && min.value >= max.value) errors.range = '"To" must be more than "from"';
  if (step && !step.ok) errors.stepSize = step.error;
  if (burr && !burr.ok) errors.burrSizeMm = burr.error;
  if (Object.keys(errors).length) return { errors, values: null };
  return {
    errors,
    values: {
      name: f.name.trim(),
      notes: f.notes.trim() || null,
      adjustment: f.adjustment || null,
      settingMin: min?.ok ? min.value : null,
      settingMax: max?.ok ? max.value : null,
      stepSize: step?.ok ? step.value : null,
      burrType: f.burrType || null,
      burrSizeMm: burr?.ok ? burr.value : null,
      power: f.power || null,
    },
  };
}

// The brewer a duplicated recipe starts on: another active brewer of the same
// kind (e.g. a second espresso machine), else the original's.
export function pickCopyBrewer(brewers: Brewer[], original: Pick<Brewer, 'id' | 'kind'>): string {
  const other = brewers.find((b) => !b.retiredAt && b.kind === original.kind && b.id !== original.id);
  return other?.id ?? original.id;
}
