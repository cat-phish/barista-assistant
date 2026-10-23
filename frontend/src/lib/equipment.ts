// Labels and one-line summaries for equipment (docs/api/README.md §3, §3b).
import type { BrewerInput } from '../api/brewers';
import type { Brewer, BurrType, Grinder, GrinderAdjustment, GrinderDetails, GrinderPower, MachineCapabilities, MethodKind, Preinfusion, ProfileControl, RecipeStyle } from '../api/types';
import { formatGrams, parseDecimal } from './format';

// The brew method (docs/api/brewers.md §3): how brewers are grouped, and it
// decides recipe fields, steps, the timer, and which drinks a brewer can make.
// In display order (the brew page lists methods this way).
export const METHOD_KINDS: Record<MethodKind, { label: string; hint: string }> = {
  filter: { label: 'Filter', hint: 'Dose and water: pour over, immersion, hybrid, cold brew (V60, French press, AeroPress, OXO Rapid Brewer)' },
  espresso: { label: 'Espresso', hint: 'Dose and shot weight instead of water, with the shot timer' },
  stovetop: { label: 'Stovetop', hint: 'Dose and water, on the stove: moka pot, ibrik' },
  other: { label: 'Other', hint: 'Dose and water, for anything else (a siphon, say)' },
};
export const METHOD_ORDER = Object.keys(METHOD_KINDS) as MethodKind[];
// The built-in recipe styles' names, and which ones each method has: what a
// custom style can "brew like" (docs/api/recipe-styles.md §5e). The
// workspace's own list (renamed, hidden, custom) comes from the API.
export const RECIPE_STYLES: Record<RecipeStyle, string> = {
  pour_over: 'Pour over',
  immersion: 'Immersion',
  hybrid: 'Hybrid',
  cold_brew: 'Cold brew',
  standard: 'Standard',
  soup: 'Soup',
  moka: 'Moka',
  ibrik: 'Ibrik',
  other: 'Other',
};
export const STYLES_BY_KIND: Record<MethodKind, RecipeStyle[]> = {
  filter: ['pour_over', 'immersion', 'hybrid', 'cold_brew', 'other'],
  espresso: ['standard', 'soup', 'other'],
  stovetop: ['moka', 'ibrik', 'other'],
  other: ['other'],
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
  const other = brewers.find((b) => !b.archivedAt && b.kind === original.kind && b.id !== original.id);
  return other?.id ?? original.id;
}

// Grinder table cells (null when not set): "Hand" / "Electric",
// "Conical 39 mm", "Stepped · 0–40".
export function powerLabel(g: Grinder): string | null {
  return g.power === null ? null : g.power === 'manual' ? 'Hand' : 'Electric';
}
export function burrLabel(g: Grinder): string | null {
  if (!g.burrType && g.burrSizeMm === null) return null;
  return [g.burrType ? BURR_TYPES[g.burrType] : 'Burrs', g.burrSizeMm !== null ? `${g.burrSizeMm} mm` : ''].filter(Boolean).join(' ');
}
export function adjustmentLabel(g: Grinder): string | null {
  if (!g.adjustment) return null;
  const kind = g.adjustment === 'stepped' ? 'Stepped' : 'Stepless';
  return g.settingMin !== null && g.settingMax !== null ? `${kind} · ${formatGrams(g.settingMin)}–${formatGrams(g.settingMax)}` : kind;
}

// Brewer add/edit form (docs/api/brewers.md §3): text inputs; capabilities only
// count for espresso brewers.
export interface BrewerForm extends MachineCapabilities {
  name: string;
  methodId: string; // the workspace's method (docs/api/brewer-methods.md §3e); '' = by kind
  kind: MethodKind; // follows the method's behaviour (BrewerFields keeps it in step)
  notes: string;
}

export function brewerForm(m?: Brewer): BrewerForm {
  return {
    name: m?.name ?? '',
    methodId: m?.methodId ?? '',
    kind: m?.kind ?? 'filter',
    notes: m?.notes ?? '',
    preinfusion: m?.preinfusion ?? 'none',
    flowControl: m?.flowControl ?? 'none',
    pressureControl: m?.pressureControl ?? 'none',
  };
}
export function brewerInput(f: BrewerForm): BrewerInput & { name: string } {
  const espresso = f.kind === 'espresso';
  return {
    name: f.name.trim(),
    // The method decides the kind on the server; without one, the kind's built-in method.
    ...(f.methodId ? { methodId: f.methodId } : { kind: f.kind }),
    notes: f.notes.trim() || null,
    // Capabilities only mean something for espresso.
    preinfusion: espresso ? f.preinfusion : 'none',
    flowControl: espresso ? f.flowControl : 'none',
    pressureControl: espresso ? f.pressureControl : 'none',
  };
}
