// Pure parsing/formatting helpers shared by the forms. Unit-tested in format.test.ts.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

// "18.5" or "18,5" -> 18.5. Mirrors the API's decimal rules (docs/api_spec.md §5):
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
export function formatTime(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60);
  const s = totalSeconds % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

// "2:30" -> 150, "45" -> 45 (plain seconds), "0:05" -> 5. Max 24 h, as the API.
export function parseTime(text: string): Parsed<number> {
  const t = text.trim();
  let seconds: number;
  const mmss = /^(\d{1,4}):([0-5]\d)$/.exec(t);
  if (mmss) seconds = Number(mmss[1]) * 60 + Number(mmss[2]);
  else if (/^\d{1,5}$/.test(t)) seconds = Number(t);
  else return { ok: false, error: 'Use m:ss, e.g. 1:30' };
  if (seconds > 24 * 60 * 60) return { ok: false, error: 'At most 24 hours' };
  return { ok: true, value: seconds };
}

export interface StepDraft {
  actionName: string;
  time: string; // m:ss
  water: string; // grams
}

export interface ParsedStep {
  actionName: string;
  targetTimeSec: number;
  targetWaterGrams: number;
}

// Validates the pour-steps editor. Steps are cumulative: each one ends later
// than the previous one, and the scale weight never goes down (§5).
export function parseSteps(drafts: StepDraft[]): { steps: ParsedStep[]; errors: Record<number, string> } {
  const steps: ParsedStep[] = [];
  const errors: Record<number, string> = {};
  drafts.forEach((d, i) => {
    const time = parseTime(d.time);
    const water = parseDecimal(d.water, { scale: 2, min: 0, max: 10000, exclusiveMax: true });
    const name = d.actionName.trim();
    if (!name) errors[i] = 'Name this step, e.g. Bloom';
    else if (!time.ok) errors[i] = `Time: ${time.error}`;
    else if (!water.ok) errors[i] = `Water: ${water.error}`;
    else {
      const prev = steps[steps.length - 1];
      if (prev && time.value <= prev.targetTimeSec) errors[i] = `Must end after the previous step (${formatTime(prev.targetTimeSec)})`;
      else if (prev && water.value < prev.targetWaterGrams) errors[i] = `Water is cumulative: at least ${prev.targetWaterGrams} g`;
      steps.push({ actionName: name, targetTimeSec: time.value, targetWaterGrams: water.value });
    }
  });
  if (drafts.length > 20) errors[20] = 'At most 20 steps';
  return { steps, errors };
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

// 15 g in, 250 g out -> "1:16.7"
export function formatRatio(dose: number, yieldGrams: number): string {
  if (dose <= 0) return '–';
  return `1:${(Math.round((yieldGrams / dose) * 10) / 10).toString()}`;
}

// 15 -> "15", 18.5 -> "18.5" (no trailing zeros; API decimals are numbers).
export function formatGrams(value: number): string {
  return `${Number(value.toFixed(2))}`;
}

// Today's date in the user's timezone, as YYYY-MM-DD (for <input type="date">).
export function localDateInput(now: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

// ISO timestamp -> "Sun, Oct 19, 8:05 AM" in the user's locale and time zone.
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
