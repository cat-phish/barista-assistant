import { describe, expect, it } from 'vitest';
import type { GreenCoffee } from '../api/types';
import { formatStock, greenForm, greenPrice, greenStock, machineForm, parseGreenForm, parseMachineForm } from './roasting';

describe('roasting machine form', () => {
  it('needs a name; capacity is whole grams', () => {
    expect(parseMachineForm({ name: ' ', notes: '', capacity: '' }).errors.name).toBe('Required');
    expect(parseMachineForm({ name: 'Nano', notes: '', capacity: '1.5' }).errors.capacity).toBe('Use a whole number');
    expect(parseMachineForm({ name: ' Nano 7 ', notes: ' ', capacity: '120' }).values).toEqual({ name: 'Nano 7', notes: null, capacityGrams: 120 });
    expect(machineForm({ id: 'm', name: 'Behmor', notes: null, capacityGrams: null, archivedAt: null, createdAt: '' })).toEqual({ name: 'Behmor', notes: '', capacity: '' });
  });
});

describe('green coffee form', () => {
  const blank = greenForm('m', undefined, 'USD');
  it('starts blank with the last currency; stock left defaults to what was bought', () => {
    expect(blank).toMatchObject({ name: '', currency: 'USD', left: '' });
    const { values } = parseGreenForm({ ...blank, name: ' Guji ', bought: '2270', price: '' }, 'm', '2026-10-28');
    expect(values).toMatchObject({ name: 'Guji', weightBoughtGrams: 2270, weightLeftGrams: 2270, priceAmount: null, priceCurrency: null, varieties: null });
    expect(parseGreenForm({ ...blank, name: 'A' }, 'm').values?.weightLeftGrams).toBe(0);
  });
  it('checks price, weights, altitude and the purchase date', () => {
    const errors = (f: Partial<typeof blank>) => parseGreenForm({ ...blank, name: 'A', ...f }, 'm', '2026-10-28').errors;
    expect(errors({ price: '10', currency: '' }).currency).toBe('Needed with a price');
    expect(errors({ price: '10', currency: 'us' }).currency).toMatch(/3-letter/);
    expect(errors({ price: '0' }).price).toBeDefined();
    expect(errors({ bought: '0' }).bought).toBeDefined();
    expect(errors({ left: '-1' }).left).toBeDefined();
    expect(errors({ altitude: '9500' }).altitude).toBeDefined();
    expect(errors({ purchaseDate: '2026-10-29' }).purchaseDate).toBeDefined();
    const ok = parseGreenForm({ ...blank, name: 'A', price: '42.5', currency: 'eur', altitude: '6562', left: '300', bought: '1000' }, 'ft', '2026-10-28').values;
    expect(ok).toMatchObject({ priceAmount: 42.5, priceCurrency: 'EUR', altitudeMasl: 2000, weightLeftGrams: 300 });
  });
  it('round-trips a saved one', () => {
    const g = { id: 'g', name: 'Guji', originArea: 'africa', country: 'Ethiopia', region: null, producer: null, altitudeMasl: 2000, varieties: ['74110'], species: ['arabica'], processId: 'p', supplier: 'SM', lot: null, priceAmount: 42.5, priceCurrency: 'USD', weightBoughtGrams: 1000, weightLeftGrams: 400, lowStockGrams: 500, purchaseDate: '2026-10-01', notes: null, archivedAt: null, createdAt: '' } satisfies GreenCoffee;
    const form = greenForm('m', g, 'EUR');
    expect(form).toMatchObject({ price: '42.50', currency: 'USD', left: '400', altitude: '2000' });
    const { id: _id, archivedAt: _a, createdAt: _c, ...input } = g;
    expect(parseGreenForm(form, 'm', '2026-10-28').values).toEqual(input);
  });
});

describe('green stock', () => {
  it('is out, low under its threshold, or fine; with the share left', () => {
    expect(greenStock({ weightLeftGrams: 0, weightBoughtGrams: 1000, lowStockGrams: null })).toEqual({ state: 'out', percent: 0 });
    expect(greenStock({ weightLeftGrams: 400, weightBoughtGrams: 1000, lowStockGrams: 500 })).toEqual({ state: 'low', percent: 40 });
    expect(greenStock({ weightLeftGrams: 500, weightBoughtGrams: null, lowStockGrams: 500 })).toEqual({ state: 'ok', percent: null });
  });
  it('words weights and prices', () => {
    expect(formatStock(1810)).toBe('1.81 kg');
    expect(formatStock(450)).toBe('450 g');
    expect(greenPrice({ priceAmount: 42.5, priceCurrency: 'USD', weightBoughtGrams: 2270 })).toBe('42.50 USD · 1.87 USD/100 g');
    expect(greenPrice({ priceAmount: 42.5, priceCurrency: 'USD', weightBoughtGrams: null })).toBe('42.50 USD');
    expect(greenPrice({ priceAmount: null, priceCurrency: null, weightBoughtGrams: 1 })).toBeNull();
  });
});
