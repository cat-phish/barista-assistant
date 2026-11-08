import { describe, expect, it } from 'vitest';
import { compile, evaluate, formatCalc, parseCalcNumber, runCalculator } from './calc';
import type { NoteCalculatorBlock } from '../api/types';

const calc = (formula: string, vars: Record<string, number> = {}) => {
  const c = compile(formula);
  if (!c.ok) throw new Error(c.error);
  return evaluate(c.node, new Map(Object.entries(vars).map(([k, v]) => [k.toLowerCase(), v])));
};
const errorOf = (formula: string) => {
  const c = compile(formula);
  return c.ok ? null : c.error;
};

describe('formulas', () => {
  it('works out arithmetic in the usual order', () => {
    expect(calc('1 + 2 * 3')).toBe(7);
    expect(calc('(1 + 2) * 3')).toBe(9);
    expect(calc('10 - 4 - 3')).toBe(3);
    expect(calc('2 ^ 3 ^ 2')).toBe(512);
    expect(calc('-2 ^ 2')).toBe(-4);
    expect(calc('7 % 3')).toBe(1);
    expect(calc('.5 * 4')).toBe(2);
    expect(calc('6 × 2 ÷ 4 − 1')).toBe(2);
    expect(calc('--3 + +2')).toBe(5);
  });

  it('reads keys ignoring case, and lists them', () => {
    expect(calc('Water * per_litre', { water: 1.8, PER_LITRE: 20 })).toBeCloseTo(36);
    const c = compile('round(water * per_litre, 1) + water');
    expect(c.ok && c.refs).toEqual(['water', 'per_litre']);
  });

  it('has a few functions', () => {
    expect(calc('round(2.345, 2)')).toBe(2.35);
    expect(calc('round(2.5)')).toBe(3);
    expect(calc('floor(2.9) + ceil(2.1) + abs(-1) + sqrt(16)')).toBe(10);
    expect(calc('min(3, 1, 2) + max(3, 1, 2)')).toBe(4);
  });

  it('says what is wrong with a formula', () => {
    expect(errorOf('')).toBe('Enter a formula');
    expect(errorOf('1 +')).toBe('The formula ends too soon');
    expect(errorOf('(1 + 2')).toBe('Missing “)”');
    expect(errorOf('1 + 2)')).toBe('A “)” without its “(”');
    expect(errorOf('2 water')).toBe('Missing an operator before “water”');
    expect(errorOf('* 2')).toBe('“*” needs a number before it');
    expect(errorOf('1 $ 2')).toBe('“$” can\'t be used in a formula');
    expect(errorOf('pow(2, 3)')).toMatch(/^There's no function called pow/);
    expect(errorOf('round()')).toBe('round takes 1 to 2 values');
    expect(errorOf('sqrt(1, 2)')).toBe('sqrt takes 1 value');
    expect(errorOf('1..2')).toBe('“.” isn\'t a number');
  });

  it('never runs code', () => {
    expect(errorOf('alert(1)')).toMatch(/^There's no function called alert/);
    expect(errorOf('constructor.constructor("x")()')).toBe('“.” isn\'t a number');
    expect(errorOf('water["x"]')).toBe('“[” can\'t be used in a formula');
    expect(() => calc('__proto__')).toThrow('Nothing is called __proto__');
  });
});

describe('a calculator', () => {
  const descaler: NoteCalculatorBlock = {
    id: 'c1',
    type: 'calculator',
    title: 'Descaler',
    inputs: [
      { key: 'water', label: 'Water in tank', unit: 'L', value: 1 },
      { key: 'per_litre', label: 'Strength', unit: 'g', value: 20 },
    ],
    results: [
      { key: 'powder', label: 'Powder', unit: 'g', formula: 'water * per_litre', decimals: 0 },
      { key: 'scoops', label: 'Scoops', unit: '', formula: 'ceil(powder / 15)', decimals: 0 },
    ],
  };

  it('works each result out from the inputs and the results above it', () => {
    expect(runCalculator(descaler, { water: 1.8, per_litre: 20 })).toEqual([
      { key: 'powder', value: 36, error: null },
      { key: 'scoops', value: 3, error: null },
    ]);
  });

  it('explains what stops a result, and carries it to the ones that use it', () => {
    expect(runCalculator(descaler, { water: null, per_litre: 20 }).map((r) => r.error)).toEqual(['Enter Water in tank', 'Powder can\'t be worked out']);
    expect(runCalculator(descaler, { water: 0, per_litre: 20 })[0]).toEqual({ key: 'powder', value: 0, error: null });
    const swapped = { ...descaler, results: [...descaler.results].reverse() };
    expect(runCalculator(swapped, { water: 1, per_litre: 20 })[0]!.error).toBe('It uses powder, which comes after it: move it up');
    const zero = { ...descaler, results: [{ key: 'x', label: 'X', unit: '', formula: 'water / (per_litre - 20)', decimals: 0 }] };
    expect(runCalculator(zero, { water: 1, per_litre: 20 })[0]!.error).toBe("Can't divide by zero");
    const self = { ...descaler, results: [{ key: 'x', label: 'X', unit: '', formula: 'x + 1', decimals: 0 }] };
    expect(runCalculator(self, { water: 1, per_litre: 20 })[0]!.error).toBe("It can't use itself (x)");
    const huge = { ...descaler, results: [{ key: 'x', label: 'X', unit: '', formula: '10 ^ 400', decimals: 0 }] };
    expect(runCalculator(huge, { water: 1, per_litre: 20 })[0]!.error).toBe('Too big to work out');
  });
});

describe('numbers in and out', () => {
  it('reads what someone types', () => {
    expect(parseCalcNumber('1,8')).toBe(1.8);
    expect(parseCalcNumber(' -2.5 ')).toBe(-2.5);
    expect(parseCalcNumber('.5')).toBe(0.5);
    expect(parseCalcNumber('')).toBeNull();
    expect(parseCalcNumber('1.2.3')).toBeNull();
    expect(parseCalcNumber('2 L')).toBeNull();
  });

  it('shows a result to its decimals, without trailing zeros', () => {
    expect(formatCalc(36.0001, 0)).toBe('36');
    expect(formatCalc(7.098, 1)).toBe('7.1');
    expect(formatCalc(1.8, 2)).toBe('1.8');
    expect(formatCalc(-0.0001, 2)).toBe('0');
    expect(formatCalc(12345.678, 1)).toBe('12345.7');
  });
});
