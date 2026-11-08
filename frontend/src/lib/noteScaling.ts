// Scaling amounts in a note (docs/api/notes.md §3h): a line like "20 g per
// 1 L", "2 tablets per litre" or "1 tbsp / 500 ml" is an amount for a
// volume, and the Notes page works it out for any other volume ("for 1.8 L:
// 36 g"). Only the page does this; nothing is stored. The amount's own unit
// is whatever the line says (g, tablets, tbsp) and scales unchanged.
import { GRAMS_PER_FL_OZ } from './scale';

export type ScaleUnit = 'l' | 'ml' | 'fl_oz';
export const SCALE_UNITS: Record<ScaleUnit, { label: string; ml: number }> = {
  l: { label: 'L', ml: 1000 },
  ml: { label: 'ml', ml: 1 },
  fl_oz: { label: 'fl oz', ml: GRAMS_PER_FL_OZ },
};

export interface ScalableLine {
  label: string; // "Cleaning powder", from the text around the amount
  text: string; // "20 g per 1 L", as written
  amount: number; // 20
  unit: string; // "g" ("" for a bare count: "2 per litre")
  perMl: number; // 1000: the volume the amount is for
}

// The volume units a line can be per, in millilitres.
const PER_UNIT_ML: Array<[RegExp, number]> = [
  [/^ml$/i, 1],
  [/^cl$/i, 10],
  [/^dl$/i, 100],
  [/^(l|litres?|liters?)$/i, 1000],
  [/^fl\.?\s?oz$/i, GRAMS_PER_FL_OZ],
];
const NUMBER = String.raw`\d+(?:[.,]\d+)?`;
// amount, its unit, up to four words of what it is, "per" or "/", a volume
// (1 if left out) and its unit: "20 g citric acid per 1 L".
const LINE = new RegExp(
  String.raw`(${NUMBER})\s*((?!per\b)[a-zA-Zµ]+\.?)?((?:\s+(?!per\b)[^\s\d/|]+){0,4}?)\s*(?:\bper\b|/)\s*(?:(${NUMBER})\s*)?(ml|cl|dl|l|litres?|liters?|fl\.?\s?oz)(?![a-zA-Z])`,
  'i',
);

const toNumber = (text: string) => Number(text.replace(',', '.'));
// Markdown around a label: list markers, headings, quotes, emphasis, table pipes.
const plain = (text: string) =>
  text
    .replace(/^\s*(?:[-*+]|\d+[.)]|#{1,6}|>)\s+/, '')
    .replace(/[*_`|]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/[\s:–—=-]+$/, '')
    .trim();

// The first amount-per-volume on each line that has one.
export function scalableLines(body: string): ScalableLine[] {
  const out: ScalableLine[] = [];
  for (const line of body.split('\n')) {
    const m = LINE.exec(line);
    if (!m) continue;
    const [text, amount, unit = '', what = '', volume, volumeUnit = ''] = m;
    const unitMl = PER_UNIT_ML.find(([re]) => re.test(volumeUnit.trim()))?.[1];
    const perMl = (volume ? toNumber(volume) : 1) * (unitMl ?? 0);
    if (!(perMl > 0)) continue;
    const label = plain(line.slice(0, m.index)) || plain(what) || plain(line);
    out.push({ label, text: text.trim(), amount: toNumber(amount!), unit, perMl });
  }
  return out;
}

// The amount for `volume` of `unit`.
export function scaledAmount(line: ScalableLine, volume: number, unit: ScaleUnit): number {
  return (line.amount * volume * SCALE_UNITS[unit].ml) / line.perMl;
}

// Rounded to what can be measured: 36, 7.5, 0.33.
export function formatScaled(value: number): string {
  const digits = value >= 100 ? 0 : value >= 10 ? 1 : 2;
  return `${Number(value.toFixed(digits))}`;
}
