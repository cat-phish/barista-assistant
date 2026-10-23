// Display units from the person's preferences (roadmap: Units and defaults; docs/api/auth.md
// §1 preferences). Storage never changes: temperatures in °C (0.1), altitude
// in whole metres, weights in grams. Forms show and take the chosen unit and
// convert at the edges; their text keeps enough precision that saving an
// untouched value gives back exactly what was stored.
import type { AltitudeUnit, TemperatureUnit, VolumeUnit } from '../api/types';
import { formatGrams, parseDecimal, type Parsed } from './format';
import { GRAMS_PER_FL_OZ } from './scale';

const round1 = (n: number) => Math.round(n * 10) / 10;

// ---- Temperature -------------------------------------------------------------

export const TEMPERATURE_LABELS: Record<TemperatureUnit, string> = { c: '°C', f: '°F' };
const toF = (c: number) => (c * 9) / 5 + 32;
const toC = (f: number) => ((f - 32) * 5) / 9;

// Lists and headings: whole °F (°C as stored).
export function formatTemp(c: number, unit: TemperatureUnit): string {
  return unit === 'f' ? `${Math.round(toF(c))} °F` : `${formatGrams(c)} °C`;
}

// A suggested change (the AI's °C delta): "+2 °F", "−1.5 °C", or "Keep the temperature".
export function formatTempChange(deltaC: number, unit: TemperatureUnit): string {
  if (deltaC === 0) return 'Keep the temperature';
  const d = unit === 'f' ? Math.round(Math.abs(deltaC) * 1.8 * 2) / 2 : Math.abs(deltaC);
  return `${deltaC > 0 ? '+' : '−'}${formatGrams(d)} ${TEMPERATURE_LABELS[unit]}`;
}

// A stored °C value as form text (0.1 °F, so it converts back exactly).
export function tempText(c: number | null | undefined, unit: TemperatureUnit): string {
  if (c == null) return '';
  return formatGrams(unit === 'f' ? round1(toF(c)) : c);
}

// Form text in the chosen unit -> °C to store (0.1). Same range as the API: 0–100 °C.
export function parseTemp(text: string, unit: TemperatureUnit): Parsed<number> {
  if (unit === 'c') return parseDecimal(text, { scale: 1, min: 0, max: 100 });
  const f = parseDecimal(text, { scale: 1, min: 32, max: 212 });
  return f.ok ? { ok: true, value: round1(toC(f.value)) } : f;
}

// ---- Altitude ----------------------------------------------------------------

export const ALTITUDE_LABELS: Record<AltitudeUnit, string> = { m: 'm', ft: 'ft' };
const FEET_PER_METRE = 3.28084;

export function formatAltitude(masl: number, unit: AltitudeUnit = 'm'): string {
  const n = unit === 'ft' ? Math.round(masl * FEET_PER_METRE) : masl;
  return `${n.toLocaleString('en-US')} ${ALTITUDE_LABELS[unit]}`;
}

export function altitudeText(masl: number | null, unit: AltitudeUnit): string {
  if (masl === null) return '';
  return String(unit === 'ft' ? Math.round(masl * FEET_PER_METRE) : masl);
}

// Whole metres to store; the API allows 0–9000 m.
export function parseAltitude(text: string, unit: AltitudeUnit): Parsed<number> {
  if (unit === 'm') return parseDecimal(text, { scale: 0, min: 0, max: 9000 });
  const ft = parseDecimal(text, { scale: 0, min: 0, max: Math.round(9000 * FEET_PER_METRE) });
  return ft.ok ? { ok: true, value: Math.round(ft.value / FEET_PER_METRE) } : ft;
}

// ---- Volume ------------------------------------------------------------------

export const VOLUME_LABELS: Record<VolumeUnit, string> = { fl_oz: 'fl oz', ml: 'ml' };

// The volume units to show a yield estimate in: the chosen one, then the other if both.
export function volumeUnits(unit: VolumeUnit, showBoth: boolean): VolumeUnit[] {
  return showBoth ? [unit, unit === 'fl_oz' ? 'ml' : 'fl_oz'] : [unit];
}

// Brewed coffee is close enough to 1 g/ml for a mug-fill estimate.
export function gramsToVolume(grams: number, unit: VolumeUnit): number {
  return unit === 'ml' ? Math.round(grams) : round1(grams / GRAMS_PER_FL_OZ);
}
