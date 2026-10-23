// Water profile form and labels (docs/api/water-profiles.md §3c). Unit-tested
// in water.test.ts.
import { WATER_FIGURES, type WaterFigure, type WaterProfile, type WaterProfileDetails } from '../api/types';
import { parseDecimal } from './format';

// Labels in the order the form shows them; GH and KH are as CaCO3.
export const WATER_FIGURE_LABELS: Record<WaterFigure, { label: string; short: string }> = {
  tdsPpm: { label: 'TDS', short: 'TDS' },
  generalHardnessPpm: { label: 'General hardness (GH, as CaCO₃)', short: 'GH' },
  alkalinityPpm: { label: 'Alkalinity (KH, as CaCO₃)', short: 'KH' },
  calciumPpm: { label: 'Calcium (Ca)', short: 'Ca' },
  magnesiumPpm: { label: 'Magnesium (Mg)', short: 'Mg' },
  sodiumPpm: { label: 'Sodium (Na)', short: 'Na' },
  potassiumPpm: { label: 'Potassium (K)', short: 'K' },
  bicarbonatePpm: { label: 'Bicarbonate (HCO₃)', short: 'HCO₃' },
  chloridePpm: { label: 'Chloride (Cl)', short: 'Cl' },
  sulfatePpm: { label: 'Sulfate (SO₄)', short: 'SO₄' },
};

export type WaterForm = Record<WaterFigure, string> & { name: string; notes: string; ph: string; isDefault: boolean };
export type WaterFormErrors = Partial<Record<WaterFigure | 'name' | 'ph', string>>;

const text = (n: number | null | undefined) => (n == null ? '' : String(n));

export function waterForm(p?: WaterProfile): WaterForm {
  const figures = Object.fromEntries(WATER_FIGURES.map((k) => [k, text(p?.[k])])) as Record<WaterFigure, string>;
  return { ...figures, name: p?.name ?? '', notes: p?.notes ?? '', ph: text(p?.ph), isDefault: p?.isDefault ?? false };
}

export function parseWaterForm(f: WaterForm): { errors: WaterFormErrors; values: (WaterProfileDetails & { name: string }) | null } {
  const errors: WaterFormErrors = {};
  if (!f.name.trim()) errors.name = 'Required';
  const figures = {} as Record<WaterFigure, number | null>;
  for (const key of WATER_FIGURES) {
    const t = f[key];
    if (!t.trim()) {
      figures[key] = null;
      continue;
    }
    const parsed = parseDecimal(t, { scale: 2, min: 0, max: 10000, exclusiveMax: true });
    if (parsed.ok) figures[key] = parsed.value;
    else errors[key] = parsed.error;
  }
  const ph = f.ph.trim() ? parseDecimal(f.ph, { scale: 1, min: 0, max: 14 }) : null;
  if (ph && !ph.ok) errors.ph = ph.error;
  if (Object.keys(errors).length) return { errors, values: null };
  return {
    errors,
    values: { ...figures, name: f.name.trim(), notes: f.notes.trim() || null, ph: ph?.ok ? ph.value : null, isDefault: f.isDefault },
  };
}

// "TDS 150 · GH 102 · KH 0 · Ca 30", the figures that are recorded, in mg/L.
export function waterSummary(p: WaterProfile): string {
  const parts = WATER_FIGURES.flatMap((k) => (p[k] === null ? [] : [`${WATER_FIGURE_LABELS[k].short} ${p[k]}`]));
  if (p.ph !== null) parts.push(`pH ${p.ph}`);
  return parts.join(' · ');
}

// The profile a new brew starts on: the workspace's default, if it's active.
export function defaultWaterProfileId(profiles: readonly WaterProfile[]): string {
  return profiles.find((p) => p.isDefault && !p.retiredAt)?.id ?? '';
}
