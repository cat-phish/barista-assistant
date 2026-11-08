import { describe, expect, it } from 'vitest';
import { formatScaled, scaledAmount, scalableLines } from './noteScaling';

const pick = (body: string) => scalableLines(body).map(({ label, amount, unit, perMl }) => ({ label, amount, unit, perMl }));

describe('scalable lines in a note', () => {
  it('finds an amount per volume in its usual shapes', () => {
    expect(pick('Cleaning powder: 20 g per 1 L')).toEqual([{ label: 'Cleaning powder', amount: 20, unit: 'g', perMl: 1000 }]);
    expect(pick('- 20 g citric acid per 1 L')).toEqual([{ label: 'citric acid', amount: 20, unit: 'g', perMl: 1000 }]);
    expect(pick('Tablets — 2 tablets per litre')).toEqual([{ label: 'Tablets', amount: 2, unit: 'tablets', perMl: 1000 }]);
    expect(pick('Descaler 1 tbsp/500ml')).toEqual([{ label: 'Descaler', amount: 1, unit: 'tbsp', perMl: 500 }]);
    expect(pick('* **Rinse aid**: 2,5 ml / 2 l')).toEqual([{ label: 'Rinse aid', amount: 2.5, unit: 'ml', perMl: 2000 }]);
    expect(pick('| Cafiza | 10 g per 33.8 fl oz |')).toEqual([{ label: 'Cafiza', amount: 10, unit: 'g', perMl: 33.8 * 29.5735 }]);
    expect(pick('Soak: 3 per 5 dl')).toEqual([{ label: 'Soak', amount: 3, unit: '', perMl: 500 }]);
  });

  it('leaves other lines alone', () => {
    expect(pick('Brew at 1:16, 94 °C\nRinse twice\nV60 02 per person\n20 g per batch\n')).toEqual([]);
    expect(pick('')).toEqual([]);
  });

  it('labels a line from its own text when nothing comes before the amount', () => {
    expect(scalableLines('20 g per 1 L')[0]!.label).toBe('20 g per 1 L');
  });

  it('works the amount out for any volume', () => {
    const [powder] = scalableLines('Cleaning powder: 20 g per 1 L');
    expect(formatScaled(scaledAmount(powder!, 1.8, 'l'))).toBe('36');
    expect(formatScaled(scaledAmount(powder!, 250, 'ml'))).toBe('5');
    expect(formatScaled(scaledAmount(powder!, 12, 'fl_oz'))).toBe('7.1');
    expect(formatScaled(1234.5)).toBe('1235');
    expect(formatScaled(0.3333)).toBe('0.33');
  });
});
