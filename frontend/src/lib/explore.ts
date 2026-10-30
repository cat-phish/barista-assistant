// Insights → Explore: pick two brew numbers, or a group and a number, and see
// how they move together (docs/roadmap.md, "Insights"). The fields here are
// what can be picked.
import type { CoffeeSpecies, OriginArea, RoastLevel, StatsBean, StatsBrew } from '../api/types';
import { COFFEE_SPECIES } from './beans';
import { ORIGIN_AREAS } from './origins';
import { ROAST_LEVELS } from './scale';
import { brewEY, brewRoastAge, localWeekday, splitCountries, type VolumeSource } from './stats';

export interface ExploreContext {
  bean: (id: string) => StatsBean | undefined;
  name: (id: string | null) => string | null;
  volume: (brew: StatsBrew) => { ml: number; source: VolumeSource } | null;
  volumeIn: (ml: number) => number; // in the chosen unit
  volumeLabel: string;
}

interface FieldBase {
  key: string;
  label: string;
  hiddenBy?: string; // a settings.hiddenFields key that hides it
}
export interface NumberField extends FieldBase {
  kind: 'number';
  group: 'result' | 'brew'; // its optgroup: how it turned out, or what it was made with
  value: (b: StatsBrew, ctx: ExploreContext) => number | null;
  labelFor?: (ctx: ExploreContext) => string; // a label that depends on the settings (volume's unit)
  decimals?: number; // on axes, tooltips and the table; default up to 1
  scale?: { min: number; max: number }; // the values' fixed range (ratings); a chart pads it
  builtFrom?: readonly string[]; // worked out from these, so a link with them is partly built in
}
export interface CategoryField extends FieldBase {
  kind: 'category';
  // A brew can be under several (its tools, a blend's countries).
  value: (b: StatsBrew, ctx: ExploreContext) => string | readonly string[] | null;
  name: (key: string, ctx: ExploreContext) => string;
}
export type ExploreField = NumberField | CategoryField;

const byName = (fallback: string) => (key: string, ctx: ExploreContext) => ctx.name(key) ?? fallback;
const plain = (key: string) => key;
const bean = (b: StatsBrew, ctx: ExploreContext) => ctx.bean(b.beanId);
const WEEKDAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
const RATING = { min: 0.5, max: 5 };

// Every number can go on either axis (never against itself).
export const NUMBERS: readonly NumberField[] = [
  { key: 'rating', label: 'Rating', kind: 'number', group: 'result', value: (b) => b.rating, scale: RATING },
  { key: 'drinkRating', label: 'Drink rating', kind: 'number', group: 'result', value: (b) => b.drinkRating, scale: RATING },
  {
    key: 'ey',
    label: 'Extraction yield (%)',
    kind: 'number',
    group: 'result',
    value: (b) => brewEY(b),
    hiddenBy: 'brew.tds',
    decimals: 1,
    builtFrom: ['tds', 'dose', 'water', 'ratio'],
  },
  { key: 'tds', label: 'TDS (%)', kind: 'number', group: 'result', value: (b) => b.tdsPercent, hiddenBy: 'brew.tds', decimals: 2 },
  {
    key: 'volume',
    label: 'Volume drunk',
    kind: 'number',
    group: 'result',
    labelFor: (ctx) => `Volume drunk (${ctx.volumeLabel})`,
    value: (b, ctx) => {
      const v = ctx.volume(b);
      return v ? ctx.volumeIn(v.ml) : null;
    },
  },
  { key: 'dose', label: 'Dose (g)', kind: 'number', group: 'brew', value: (b) => b.doseGrams },
  { key: 'water', label: 'Water (g)', kind: 'number', group: 'brew', value: (b) => b.waterGrams },
  {
    key: 'ratio',
    label: 'Ratio (1 : x)',
    kind: 'number',
    group: 'brew',
    decimals: 1,
    builtFrom: ['dose', 'water'],
    // Water + ice per gram; an espresso's shot weight per gram.
    value: (b) => {
      const liquid = b.waterGrams !== null ? b.waterGrams + (b.iceGrams ?? 0) : b.yieldGrams;
      return liquid !== null && b.doseGrams > 0 ? Math.round((liquid / b.doseGrams) * 10) / 10 : null;
    },
  },
  { key: 'temp', label: 'Water temperature (°C)', kind: 'number', group: 'brew', value: (b) => b.tempC, hiddenBy: 'brew.temp' },
  { key: 'grind', label: 'Grind setting', kind: 'number', group: 'brew', value: (b) => b.grindSetting, hiddenBy: 'brew.grind' },
  { key: 'time', label: 'Brew time (s)', kind: 'number', group: 'brew', value: (b) => (b.timeSec > 0 ? b.timeSec : null) },
  { key: 'roastAge', label: 'Roast age (days)', kind: 'number', group: 'brew', value: (b, ctx) => brewRoastAge(b, bean(b, ctx)) },
  { key: 'altitude', label: 'Altitude (masl)', kind: 'number', group: 'brew', value: (b, ctx) => bean(b, ctx)?.altitudeMasl ?? null },
];

// Groups go on the Compare side only: a bar of the average number in each.
export const GROUPS: readonly CategoryField[] = [
  { key: 'process', label: 'Process', kind: 'category', value: (b, ctx) => bean(b, ctx)?.processId ?? null, name: byName('Removed process') },
  {
    key: 'roast',
    label: 'Roast level',
    kind: 'category',
    value: (b, ctx) => bean(b, ctx)?.roastLevel ?? null,
    name: (k) => ROAST_LEVELS[k as RoastLevel]?.label ?? k,
  },
  { key: 'country', label: 'Country', kind: 'category', value: (b, ctx) => splitCountries(bean(b, ctx)?.country ?? null), name: plain },
  {
    key: 'area',
    label: 'Origin',
    kind: 'category',
    value: (b, ctx) => bean(b, ctx)?.originArea ?? null,
    name: (k) => ORIGIN_AREAS[k as OriginArea]?.label ?? k,
  },
  {
    key: 'species',
    label: 'Species',
    kind: 'category',
    value: (b, ctx) => bean(b, ctx)?.species ?? null,
    name: (k) => COFFEE_SPECIES[k as CoffeeSpecies]?.label ?? k,
  },
  { key: 'roaster', label: 'Roaster', kind: 'category', value: (b, ctx) => bean(b, ctx)?.roasterName.trim() ?? null, name: plain },
  { key: 'method', label: 'Brew method', kind: 'category', value: (b) => b.methodId, name: byName('Removed method') },
  { key: 'brewer', label: 'Brewer', kind: 'category', value: (b) => b.brewerId, name: byName('Removed brewer') },
  { key: 'recipe', label: 'Recipe', kind: 'category', value: (b) => b.recipeId, name: byName('Removed recipe') },
  { key: 'style', label: 'Recipe style', kind: 'category', value: (b) => b.styleId, name: byName('Removed style') },
  { key: 'grinder', label: 'Grinder', kind: 'category', value: (b) => b.grinderId, name: byName('Removed grinder'), hiddenBy: 'brew.grinder' },
  { key: 'tool', label: 'Prep tool used', kind: 'category', value: (b) => b.toolIds, name: byName('Removed tool'), hiddenBy: 'brew.prepTools' },
  { key: 'problem', label: 'Problem ticked', kind: 'category', value: (b) => b.problemIds, name: byName('Removed problem'), hiddenBy: 'brew.problems' },
  { key: 'weekday', label: 'Day of the week', kind: 'category', value: (b) => WEEKDAYS[localWeekday(b)]!, name: plain },
];

// Colour a scatter by one of these.
export const COLOR_BY: readonly CategoryField[] = GROUPS.filter((f) => !['tool', 'problem', 'country', 'species'].includes(f.key));

export const fieldLabel = (f: ExploreField, ctx: ExploreContext) => (f.kind === 'number' && f.labelFor ? f.labelFor(ctx) : f.label);

// The picks from the URL: Compare (x) is a number or a group, With (y) a
// number; never the same field twice. Unknown keys fall back to the defaults.
export function pickAxes(xKey: string, yKey: string, numbers: readonly NumberField[], groups: readonly CategoryField[]): { x: ExploreField; y: NumberField } {
  const x = [...numbers, ...groups].find((f) => f.key === xKey) ?? numbers.find((f) => f.key === 'roastAge') ?? numbers[0]!;
  const y = numbers.find((f) => f.key === yKey && f.key !== x.key) ?? numbers.find((f) => f.key === 'rating' && f.key !== x.key) ?? numbers.find((f) => f.key !== x.key)!;
  return { x, y };
}

// A pair where one is worked out from the other: part of the link is arithmetic.
export const builtIn = (a: ExploreField, b: ExploreField) =>
  (a.kind === 'number' && !!a.builtFrom?.includes(b.key)) || (b.kind === 'number' && !!b.builtFrom?.includes(a.key));

export const visible = <F extends ExploreField>(fields: readonly F[], hidden: ReadonlySet<string>): F[] => fields.filter((f) => !f.hiddenBy || !hidden.has(f.hiddenBy));

// Least-squares line through the points, with Pearson's r; null for fewer
// than 3 points or when x never changes.
export function linearFit(points: ReadonlyArray<{ x: number; y: number }>): { slope: number; intercept: number; r: number; n: number } | null {
  const n = points.length;
  if (n < 3) return null;
  const mx = points.reduce((s, p) => s + p.x, 0) / n;
  const my = points.reduce((s, p) => s + p.y, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (const p of points) {
    sxy += (p.x - mx) * (p.y - my);
    sxx += (p.x - mx) ** 2;
    syy += (p.y - my) ** 2;
  }
  if (sxx === 0) return null;
  const slope = sxy / sxx;
  return { slope, intercept: my - slope * mx, r: syy === 0 ? 0 : sxy / Math.sqrt(sxx * syy), n };
}

// How strong a correlation reads, in words.
export function strength(r: number): string {
  const a = Math.abs(r);
  if (a < 0.1) return 'no clear link';
  const word = a < 0.3 ? 'a weak' : a < 0.6 ? 'a moderate' : 'a strong';
  return `${word} ${r > 0 ? 'positive' : 'negative'} link`;
}
