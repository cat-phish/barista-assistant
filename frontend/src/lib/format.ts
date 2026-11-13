// Pure parsing/formatting helpers shared by the forms. Unit-tested in format.test.ts.
import { ratioWater } from './scale';

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// "18.5" or "18,5" -> 18.5. Mirrors the API's decimal rules (docs/api/recipes.md §5):
// at most `scale` decimals, within (min, max) with exclusive bounds as flagged.
export function parseDecimal(
  text: string,
  opts: { scale: number; min: number; max: number; exclusiveMin?: boolean; exclusiveMax?: boolean },
): Parsed<number> {
  const trimmed = text.trim().replace(',', '.');
  if (!/^\d+(\.\d+)?$/.test(trimmed)) return { ok: false, error: 'Enter a number' };
  const [, decimals = ''] = trimmed.split('.');
  if (decimals.length > opts.scale) {
    return { ok: false, error: opts.scale === 0 ? 'Use a whole number' : `At most ${opts.scale} decimal place${opts.scale === 1 ? '' : 's'}` };
  }
  const value = Number(trimmed);
  if (opts.exclusiveMin ? value <= opts.min : value < opts.min) {
    return { ok: false, error: opts.exclusiveMin ? `Must be more than ${opts.min}` : `Must be at least ${opts.min}` };
  }
  if (opts.exclusiveMax ? value >= opts.max : value > opts.max) {
    return { ok: false, error: opts.exclusiveMax ? `Must be less than ${opts.max}` : `Must be at most ${opts.max}` };
  }
  return { ok: true, value };
}

// 150 -> "2:30"
// "2:30", and from an hour on "16:00:00" (a long cold brew's steep).
export function formatTime(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const ss = String(s).padStart(2, '0');
  return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${Math.floor(totalSeconds / 60)}:${ss}`;
}

// A time field as typed on a number pad (no colon key): the digits fill in
// from the right, like a microwave. "3" -> "0:03", "330" -> "3:30",
// "1030" -> "10:30", "160000" -> "16:00:00". Colons and anything else typed
// are ignored, so "3:30" typed in full stays "3:30". At most 7 digits
// (168:00:00, the 7 day limit).
export function maskTime(text: string): string {
  const digits = text.replace(/\D/g, '').replace(/^0+/, '').slice(0, 7);
  if (!digits) return /\d/.test(text) ? '0:00' : '';
  const ss = digits.slice(-2).padStart(2, '0');
  const rest = digits.slice(0, -2);
  if (rest.length <= 2) return `${rest || '0'}:${ss}`;
  return `${rest.slice(0, -2)}:${rest.slice(-2)}:${ss}`;
}

// "2:30" -> 150, "45" -> 45 (plain seconds), "0:05" -> 5, "16:00:00" -> 57600.
// Max 7 days, as the API (long cold brews).
export const MAX_BREW_SEC = 7 * 24 * 60 * 60;
export function parseTime(text: string): Parsed<number> {
  const t = text.trim();
  let seconds: number;
  const hmmss = /^(\d{1,3}):([0-5]\d):([0-5]\d)$/.exec(t);
  const mmss = /^(\d{1,4}):([0-5]\d)$/.exec(t);
  if (hmmss) seconds = Number(hmmss[1]) * 3600 + Number(hmmss[2]) * 60 + Number(hmmss[3]);
  else if (mmss) seconds = Number(mmss[1]) * 60 + Number(mmss[2]);
  else if (/^\d{1,6}$/.test(t)) seconds = Number(t);
  else return { ok: false, error: 'Use m:ss, e.g. 1:30 (or h:mm:ss)' };
  if (seconds > MAX_BREW_SEC) return { ok: false, error: 'At most 7 days' };
  return { ok: true, value: seconds };
}

// API roast dates are ISO datetimes at midnight UTC: keep just the date.
export function toDateInput(iso: string | null): string {
  return iso ? iso.slice(0, 10) : '';
}

// "2026-10-10" -> "Oct 10" (calendar date, no time zone shift).
export function formatDay(date: string): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  return new Date(y ?? 0, (m ?? 1) - 1, d ?? 1).toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

// A calendar date as a list date: "Oct 10", or "Oct 10, 2025" outside this year.
export function formatListDay(date: string, now: Date = new Date()): string {
  const [y, m, d] = date.slice(0, 10).split('-').map(Number);
  const day = new Date(y ?? 0, (m ?? 1) - 1, d ?? 1);
  const sameYear = day.getFullYear() === now.getFullYear();
  return day.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

// An ISO timestamp as a list date: "Oct 21", or "Oct 21, 2025" outside this year.
export function formatAdded(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, sameYear ? { month: 'short', day: 'numeric' } : { month: 'short', day: 'numeric', year: 'numeric' });
}

// 15 g in, 250 g out -> "1:16.7"
export function formatRatio(dose: number, yieldGrams: number): string {
  if (dose <= 0) return '–';
  return `1:${(Math.round((yieldGrams / dose) * 10) / 10).toString()}`;
}

// 15 -> "15", 18.5 -> "18.5" (no trailing zeros; API decimals are numbers).
export function formatGrams(value: number): string {
  return `${Number(value.toFixed(2))}`;
}

// A weight box nudged by a few grams (the brew form's −5 −1 +1 +5 under
// Water): "250" + 1 → "251", "250,5" − 1 → "249.5". Empty counts as 0, and
// nothing left (0 or less) empties the box so the required error shows.
export function nudgeGrams(text: string, delta: number): string {
  const n = Number(text.replace(',', '.'));
  const next = (text.trim() && Number.isFinite(n) ? n : 0) + delta;
  return next > 0 ? formatGrams(next) : '';
}

// A grind setting, the number on the grinder's dial: "20", "4.25".
export function formatGrind(value: number): string {
  return formatGrams(value);
}

// The grind setting rules (docs/api/brew-logs.md §6), for parseDecimal.
export const GRIND_SETTING = { scale: 2, min: 0, max: 10000, exclusiveMax: true } as const;

// Today's date in the user's timezone, as YYYY-MM-DD (for <input type="date">).
export function localDateInput(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ISO timestamp -> "Sun, Oct 19, 8:05 AM" in the user's locale and time zone.
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}

// "15 g : 250 g (1:16.7)"; flash chilled counts the ice (docs/api/recipes.md
// §5): "15 g : 250 g (150 g water + 100 g ice · 1:16.7)"; espresso has no
// water, so dose → shot weight: "18 g → 36 g (1:2)".
export function formatDoseLine(dose: number, water: number | null, out: number | null, ice: number | null): string {
  if (water !== null && ice !== null) {
    const total = ratioWater(water, ice);
    return `${formatGrams(dose)} g : ${formatGrams(total)} g (${formatGrams(water)} g water + ${formatGrams(ice)} g ice · ${formatRatio(dose, total)})`;
  }
  if (water !== null) return `${formatGrams(dose)} g : ${formatGrams(water)} g (${formatRatio(dose, water)})`;
  if (out !== null) return `${formatGrams(dose)} g → ${formatGrams(out)} g (${formatRatio(dose, out)})`;
  return `${formatGrams(dose)} g`;
}
