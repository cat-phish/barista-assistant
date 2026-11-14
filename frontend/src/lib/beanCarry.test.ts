import { describe, expect, it } from 'vitest';
import { CARRY_LIST, nextBatchValues } from './beanCarry';

// The shared list, read as text: the frontend doesn't import @barista/shared.
const shared = Object.values(import.meta.glob('../../../shared/src/beanCarry.ts', { query: '?raw', import: 'default', eager: true }))[0] as string;
const sharedKeys = [...shared.slice(shared.indexOf('BEAN_CARRY_KEYS = ['), shared.indexOf('] as const')).matchAll(/^\s+"(\w+)"/gm)].map((m) => m[1]);

describe('batch add carry-over boxes (docs/api/beans.md §4)', () => {
  it('has a box for every shared key, once, in the same order, each with a label', () => {
    expect(sharedKeys.length).toBeGreaterThan(20);
    expect(CARRY_LIST.map((c) => c.key)).toEqual(sharedKeys);
    for (const c of CARRY_LIST) expect(c.label, c.key).not.toMatch(/^bean\./);
  });

  it('keeps what is ticked, blanks the rest, and moves the batch number on', () => {
    const blank = { roasterName: '', beanName: '', inventory: '0', price: '', currency: 'USD', roastDate: '', batchNumber: '', suggestions: {}, originArea: '', country: '' };
    const values = { roasterName: 'Home roast', beanName: 'Guji', inventory: '102', price: '12', currency: 'EUR', roastDate: '2026-11-12', batchNumber: '3', suggestions: { notes: {} }, originArea: 'africa', country: 'Ethiopia' };
    expect(nextBatchValues(values, blank, ['roasterName', 'beanName', 'origin'])).toEqual({
      ...values,
      inventory: '0',
      price: '',
      currency: 'USD',
      roastDate: '',
      batchNumber: '4',
      suggestions: {},
    });
    expect(nextBatchValues({ ...values, batchNumber: 'R-2' }, blank, []).batchNumber).toBe('');
  });
});

describe('the default boxes', () => {
  it('match the shared default', async () => {
    const { DEFAULT_BEAN_CARRY } = await import('./beanCarry');
    const perBag = [...shared.slice(shared.indexOf('PER_BAG'), shared.indexOf('];', shared.indexOf('PER_BAG'))).matchAll(/"(\w+)"/g)].map((m) => m[1]);
    expect(DEFAULT_BEAN_CARRY).toEqual(sharedKeys.filter((k) => !perBag.includes(k)));
  });
});
