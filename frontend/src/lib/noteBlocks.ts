// A note's blocks while it's edited (NoteFormView, NoteCalculatorEditor):
// text, and calculators with their inputs' defaults as typed ("1,8"), turned
// into the API's blocks (docs/api/notes.md §3h) on save. Plus the
// calculator templates, keys made from labels, and what search looks at.
import type { Note, NoteBlock, NoteCalculatorBlock, NoteCalcResult } from '../api/types';
import { compile, parseCalcNumber } from './calc';

export const MAX_NOTE_TEXT = 20_000; // all the text blocks together, as the API
export const MAX_DECIMALS = 6;
const KEY = /^[A-Za-z_][A-Za-z0-9_]{0,31}$/;

export interface DraftInput {
  key: string;
  label: string;
  unit: string;
  valueText: string;
}
export type DraftResult = NoteCalcResult;
export interface DraftCalculator {
  id: string;
  type: 'calculator';
  title: string;
  inputs: DraftInput[];
  results: DraftResult[];
}
export type DraftBlock = { id: string; type: 'text'; text: string } | DraftCalculator;

export const newBlockId = (): string => crypto.randomUUID();

// "Water in tank" -> "water_in_tank", unique among `taken` (lower case).
export function keyFromLabel(label: string, taken: Iterable<string> = []): string {
  let base = label
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 28);
  if (!base) base = 'value';
  if (/^\d/.test(base)) base = `n_${base}`;
  const used = new Set([...taken].map((k) => k.toLowerCase()));
  if (!used.has(base)) return base;
  for (let n = 2; ; n++) if (!used.has(`${base}_${n}`)) return `${base}_${n}`;
}

const numberText = (n: number) => `${n}`;
export function toDraft(blocks: readonly NoteBlock[]): DraftBlock[] {
  return blocks.map((b) =>
    b.type === 'text'
      ? { ...b }
      : { ...b, inputs: b.inputs.map(({ value, ...i }) => ({ ...i, valueText: numberText(value) })), results: b.results.map((r) => ({ ...r })) },
  );
}

// A draft calculator as a block, for the preview: a default that isn't a number counts as 0.
export function draftCalculator(d: DraftCalculator): NoteCalculatorBlock {
  return { ...d, inputs: d.inputs.map(({ valueText, ...i }) => ({ ...i, value: parseCalcNumber(valueText) ?? 0 })) };
}

// Empty text blocks are dropped; everything else is checked by calculatorErrors first.
export function fromDraft(drafts: readonly DraftBlock[]): NoteBlock[] {
  return drafts.flatMap((d): NoteBlock[] => {
    if (d.type === 'text') return d.text.trim() ? [{ id: d.id, type: 'text', text: d.text }] : [];
    const c = draftCalculator(d);
    return [
      {
        ...c,
        title: c.title.trim(),
        inputs: c.inputs.map((i) => ({ ...i, key: i.key.trim(), label: i.label.trim(), unit: i.unit.trim() })),
        results: c.results.map((r) => ({ ...r, key: r.key.trim(), label: r.label.trim(), unit: r.unit.trim(), formula: r.formula.trim() })),
      },
    ];
  });
}

// What's wrong with a calculator, field by field ("inputs.0.label"), for the
// editor: saving waits until there's nothing.
export function calculatorErrors(d: DraftCalculator): Record<string, string> {
  const errors: Record<string, string> = {};
  if (!d.inputs.length) errors.inputs = 'Add at least one input.';
  if (!d.results.length) errors.results = 'Add at least one result.';
  const seen = new Map<string, string>();
  const checkField = (where: 'inputs' | 'results', i: number, f: { key: string; label: string }) => {
    if (!f.label.trim()) errors[`${where}.${i}.label`] = 'Give it a label.';
    const key = f.key.trim();
    if (!KEY.test(key)) errors[`${where}.${i}.key`] = 'Letters, digits and _, starting with a letter (up to 32).';
    else if (seen.has(key.toLowerCase())) errors[`${where}.${i}.key`] = `${seen.get(key.toLowerCase())} already uses ${key}.`;
    else seen.set(key.toLowerCase(), f.label.trim() || key);
  };
  d.inputs.forEach((input, i) => {
    checkField('inputs', i, input);
    if (parseCalcNumber(input.valueText) === null) errors[`inputs.${i}.value`] = 'Enter a number.';
  });
  d.results.forEach((r, i) => checkField('results', i, r));
  // Formulas: they parse, and use only inputs and results above them.
  const known = new Set(d.inputs.map((x) => x.key.trim().toLowerCase()));
  d.results.forEach((r, i) => {
    const compiled = compile(r.formula);
    if (!compiled.ok) {
      errors[`results.${i}.formula`] = compiled.error;
    } else {
      const unknown = compiled.refs.find((ref) => !known.has(ref.toLowerCase()));
      if (unknown) {
        const later = d.results.slice(i).some((x) => x.key.trim().toLowerCase() === unknown.toLowerCase());
        errors[`results.${i}.formula`] = later ? `${unknown} comes after this result: move it up, or use an input.` : `Nothing is called ${unknown}.`;
      }
    }
    known.add(r.key.trim().toLowerCase());
  });
  return errors;
}

export const textLength = (drafts: readonly DraftBlock[]): number => drafts.reduce((n, d) => n + (d.type === 'text' ? d.text.length : 0), 0);

// Starting points for a new calculator, in the dropdown's order; everything
// can be changed after. A new one starts from Blank: one input.
export const CALCULATOR_TEMPLATES = {
  blank: {
    label: 'Blank',
    make: () => ({
      title: '',
      inputs: [{ key: 'amount', label: 'Amount', unit: '', valueText: '1' }],
      results: [{ key: 'result', label: 'Result', unit: '', formula: 'amount', decimals: 2 }],
    }),
  },
  perVolume: {
    label: 'Amount per volume',
    make: (): Omit<DraftCalculator, 'id' | 'type'> => ({
      title: 'Amount for a batch',
      inputs: [
        { key: 'volume', label: 'Water', unit: 'L', valueText: '1' },
        { key: 'per_litre', label: 'Amount per litre', unit: 'g', valueText: '20' },
      ],
      results: [{ key: 'amount', label: 'Amount needed', unit: 'g', formula: 'volume * per_litre', decimals: 1 }],
    }),
  },
  ratio: {
    label: 'Ratio',
    make: () => ({
      title: 'Ratio',
      inputs: [
        { key: 'coffee', label: 'Coffee', unit: 'g', valueText: '20' },
        { key: 'ratio', label: 'Ratio 1:', unit: '', valueText: '16' },
      ],
      results: [{ key: 'water', label: 'Water', unit: 'g', formula: 'coffee * ratio', decimals: 0 }],
    }),
  },
  percentage: {
    label: 'Dilution (percent)',
    make: () => ({
      title: 'Dilution',
      inputs: [
        { key: 'total', label: 'Total', unit: 'ml', valueText: '500' },
        { key: 'percent', label: 'Strength', unit: '%', valueText: '10' },
      ],
      results: [
        { key: 'concentrate', label: 'Concentrate', unit: 'ml', formula: 'total * percent / 100', decimals: 0 },
        { key: 'water', label: 'Water', unit: 'ml', formula: 'total - concentrate', decimals: 0 },
      ],
    }),
  },
} satisfies Record<string, { label: string; make: () => Omit<DraftCalculator, 'id' | 'type'> }>;
export type CalculatorTemplate = keyof typeof CALCULATOR_TEMPLATES;
export const DEFAULT_TEMPLATE: CalculatorTemplate = 'blank';

export const newCalculator = (template: CalculatorTemplate): DraftCalculator => ({ id: newBlockId(), type: 'calculator', ...CALCULATOR_TEMPLATES[template].make() });
export const newText = (): DraftBlock => ({ id: newBlockId(), type: 'text', text: '' });

// What the Notes page's search looks at: the title, the text, and each
// calculator's title and labels.
export function noteSearchText(n: Pick<Note, 'title' | 'blocks'>): string {
  return [
    n.title,
    ...n.blocks.flatMap((b) => (b.type === 'text' ? [b.text] : [b.title, ...b.inputs.map((i) => i.label), ...b.results.map((r) => r.label)])),
  ].join('\n');
}
