import { describe, expect, it } from 'vitest';
import type { NoteBlock } from '../api/types';
import { runCalculator } from './calc';
import { CALCULATOR_TEMPLATES, calculatorErrors, draftCalculator, fromDraft, keyFromLabel, newCalculator, noteSearchText, toDraft, type DraftCalculator } from './noteBlocks';

const draft = (fields: Partial<DraftCalculator> = {}): DraftCalculator => ({
  id: 'c1',
  type: 'calculator',
  title: 'Descaler',
  inputs: [{ key: 'water', label: 'Water', unit: 'L', valueText: '1,8' }],
  results: [{ key: 'powder', label: 'Powder', unit: 'g', formula: 'water * 20', decimals: 0 }],
  ...fields,
});

describe('note blocks', () => {
  it('makes keys from labels', () => {
    expect(keyFromLabel('Water in tank')).toBe('water_in_tank');
    expect(keyFromLabel('  Café crème! ')).toBe('cafe_creme');
    expect(keyFromLabel('2nd pour')).toBe('n_2nd_pour');
    expect(keyFromLabel('%')).toBe('value');
    expect(keyFromLabel('Water', ['water', 'WATER_2'])).toBe('water_3');
  });

  it('turns blocks into drafts and back, dropping empty text', () => {
    const blocks: NoteBlock[] = [
      { id: 't1', type: 'text', text: 'Portafilter out.' },
      { id: 'c1', type: 'calculator', title: 'Descaler', inputs: [{ key: 'water', label: 'Water', unit: 'L', value: 1.8 }], results: [{ key: 'powder', label: 'Powder', unit: 'g', formula: 'water * 20', decimals: 0 }] },
    ];
    const drafts = toDraft(blocks);
    expect(drafts[1]).toMatchObject({ inputs: [{ valueText: '1.8' }] });
    expect(fromDraft(drafts)).toEqual(blocks);
    expect(fromDraft([...drafts, { id: 't2', type: 'text', text: '  \n' }])).toEqual(blocks);
    expect(fromDraft([draft({ title: ' Descaler ', inputs: [{ key: ' water ', label: ' Water ', unit: ' L ', valueText: '1,8' }] })])[0]).toMatchObject({
      title: 'Descaler',
      inputs: [{ key: 'water', label: 'Water', unit: 'L', value: 1.8 }],
    });
  });

  it('finds what would stop a calculator saving', () => {
    expect(calculatorErrors(draft())).toEqual({});
    expect(calculatorErrors(draft({ inputs: [], results: [] }))).toMatchObject({ inputs: 'Add at least one input.', results: 'Add at least one result.' });
    const bad = calculatorErrors(
      draft({
        inputs: [
          { key: 'water', label: '', unit: 'L', valueText: 'lots' },
          { key: '2x', label: 'Two', unit: '', valueText: '2' },
        ],
        results: [
          { key: 'Water', label: 'Again', unit: '', formula: '1', decimals: 0 },
          { key: 'a', label: 'A', unit: '', formula: 'b + 1', decimals: 0 },
          { key: 'b', label: 'B', unit: '', formula: 'missing * (2', decimals: 0 },
          { key: 'c', label: 'C', unit: '', formula: 'nope + 1', decimals: 0 },
        ],
      }),
    );
    expect(bad).toEqual({
      'inputs.0.label': 'Give it a label.',
      'inputs.0.value': 'Enter a number.',
      'inputs.1.key': 'Letters, digits and _, starting with a letter (up to 32).',
      'results.0.key': 'water already uses Water.',
      'results.1.formula': 'b comes after this result: move it up, or use an input.',
      'results.2.formula': 'Missing “)”',
      'results.3.formula': 'Nothing is called nope.',
    });
  });

  it('every template is a working calculator', () => {
    for (const key of Object.keys(CALCULATOR_TEMPLATES) as Array<keyof typeof CALCULATOR_TEMPLATES>) {
      const d = newCalculator(key);
      expect(calculatorErrors(d), key).toEqual({});
      const block = draftCalculator(d);
      const values = Object.fromEntries(block.inputs.map((i) => [i.key, i.value]));
      expect(runCalculator(block, values).every((r) => r.error === null), key).toBe(true);
    }
    const perVolume = draftCalculator(newCalculator('perVolume'));
    expect(runCalculator(perVolume, { volume: 1.8, per_litre: 20 })[0]!.value).toBeCloseTo(36);
  });

  it('search looks at the title, the text and the calculators', () => {
    const text = noteSearchText({
      title: 'Descaling',
      blocks: [
        { id: 't1', type: 'text', text: 'Portafilter out' },
        { id: 'c1', type: 'calculator', title: 'Tank', inputs: [{ key: 'w', label: 'Water in tank', unit: 'L', value: 1 }], results: [{ key: 'p', label: 'Citric acid', unit: 'g', formula: 'w', decimals: 0 }] },
      ],
    });
    for (const word of ['Descaling', 'Portafilter', 'Tank', 'Water in tank', 'Citric acid']) expect(text).toContain(word);
  });
});
