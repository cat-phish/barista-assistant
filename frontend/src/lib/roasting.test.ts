import { describe, expect, it } from 'vitest';
import type { GreenCoffee, Roast } from '../api/types';
import { development, formatStock, greenForm, greenPrice, greenStock, machineForm, parseGreenForm, parseMachineForm, parseRoastForm, readyOn, restingRoasts, roastDay, roastForm, weightLoss } from './roasting';

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

describe('roast form', () => {
  const now = new Date('2026-10-28T12:00:00');
  const base = { ...roastForm('c', undefined, { now, restDays: 7 }), greenCoffeeId: 'g', green: '120', roasted: '102' };
  const opts = { unit: 'c' as const, scale: 'names' as const, now };
  it('starts now with the default rest days; the batch is left to the server', () => {
    expect(base).toMatchObject({ roastedAt: '2026-10-28T12:00', restDays: '7', batchNumber: '' });
    const v = parseRoastForm(base, opts).values!;
    expect(v).toMatchObject({ greenCoffeeId: 'g', greenGrams: 120, roastedGrams: 102, restDays: 7, machineId: null, roastLevel: null });
    expect(v.roastedAt).toBe(new Date('2026-10-28T12:00').toISOString());
    expect(v).not.toHaveProperty('batchNumber');
  });
  it('checks the weights, times and temperatures', () => {
    const errors = (f: Partial<typeof base>, o: Partial<typeof opts> = {}) => parseRoastForm({ ...base, ...f }, { ...opts, ...o }).errors;
    expect(errors({ greenCoffeeId: '' }).greenCoffeeId).toBeDefined();
    expect(errors({ roasted: '120' }).roasted).toBe('Less than the green weight');
    expect(errors({ roasted: '60' }).roasted).toMatch(/40%/);
    expect(errors({ firstCrack: '9:00', total: '8:30' }).firstCrack).toBe('Before the end of the roast');
    expect(errors({ total: '120:00' }).total).toBeDefined();
    expect(errors({ chargeTemp: '400' }).chargeTemp).toBeDefined();
    expect(errors({ restDays: '61' }).restDays).toBeDefined();
    expect(errors({ roastedAt: '2026-10-29T12:00' }).roastedAt).toBeDefined();
    const v = parseRoastForm({ ...base, chargeTemp: '410', dropTemp: '401', firstCrack: '7:30', total: '9:20' }, { ...opts, unit: 'f' }).values!;
    expect(v).toMatchObject({ chargeTempC: 210, dropTempC: 205, firstCrackSec: 450, totalSec: 560 });
  });
  it('roast names set the level; light to dark keeps a name while its level stays', () => {
    expect(parseRoastForm({ ...base, detailed: 'city_plus' }, opts).values).toMatchObject({ detailedRoastLevel: 'city_plus', roastLevel: 'medium' });
    const levels = { ...opts, scale: 'levels' as const };
    expect(parseRoastForm({ ...base, detailed: 'city_plus', level: 'medium' }, levels).values).toMatchObject({ detailedRoastLevel: 'city_plus', roastLevel: 'medium' });
    expect(parseRoastForm({ ...base, detailed: 'city_plus', level: 'dark' }, levels).values).toMatchObject({ detailedRoastLevel: null, roastLevel: 'dark' });
  });
  it('round-trips a saved roast', () => {
    const r: Roast = { id: 'r', greenCoffeeId: 'g', machineId: 'm', roastedAt: new Date('2026-10-20T08:15').toISOString(), utcOffsetMinutes: null, batchNumber: '3', greenGrams: 120, roastedGrams: 102, roastType: 'filter', detailedRoastLevel: 'city', roastLevel: 'medium_light', chargeTempC: 210.5, dropTempC: 205, firstCrackSec: 450, totalSec: 560, restDays: 5, notes: 'Even', beanId: 'b', userId: 'u', greenStockTakenGrams: 120, greenCoffee: null, machine: null, bean: null, createdAt: '' };
    const f = roastForm('c', r);
    expect(f).toMatchObject({ firstCrack: '7:30', total: '9:20', chargeTemp: '210.5', batchNumber: '3' });
    expect(parseRoastForm(f, opts).values).toMatchObject({ batchNumber: '3', machineId: 'm', roastedAt: r.roastedAt, chargeTempC: 210.5, detailedRoastLevel: 'city' });
  });
});

describe('roast numbers', () => {
  it('weight loss, development and the day it is ready', () => {
    expect(weightLoss(120, 102)).toBe(15);
    expect(development(450, 560)).toEqual({ sec: 110, percent: 19.6 });
    expect(development(null, 560)).toBeNull();
    // 23:30 PDT on the 20th is the 21st in UTC: the local day counts.
    const r = { roastedAt: '2026-10-21T06:30:00.000Z', utcOffsetMinutes: -420, restDays: 12 };
    expect(roastDay(r)).toBe('2026-10-20');
    expect(readyOn(r)).toBe('2026-11-01');
  });
});

describe('resting roasts', () => {
  const roast = (id: string, roastedAt: string, restDays: number, bean: Roast['bean']): Roast => ({
    id, greenCoffeeId: 'g', machineId: null, roastedAt, utcOffsetMinutes: 0, batchNumber: null, greenGrams: 100, roastedGrams: 85, roastType: null, detailedRoastLevel: null, roastLevel: null,
    chargeTempC: null, dropTempC: null, firstCrackSec: null, totalSec: null, restDays, notes: null, beanId: bean?.id ?? null, userId: 'u', greenStockTakenGrams: 100, greenCoffee: null, machine: null, bean, createdAt: '',
  });
  const inUse = (id: string, grams = 85, archived = false) => ({ id, inventoryWeightGrams: grams, archived });

  it('lists resting ones soonest first, then ready ones still in use, latest ready first', () => {
    const today = '2026-10-29';
    const { resting, ready } = restingRoasts(
      [
        roast('soon', '2026-10-25T10:00:00Z', 5, inUse('b1')), // ready Oct 30
        roast('later', '2026-10-28T10:00:00Z', 7, inUse('b2')), // Nov 4
        roast('today', '2026-10-22T10:00:00Z', 7, inUse('b3')), // ready today
        roast('earlier', '2026-10-10T10:00:00Z', 7, inUse('b4')),
        roast('drunk', '2026-10-12T10:00:00Z', 7, inUse('b5', 0)),
        roast('archived', '2026-10-12T10:00:00Z', 7, inUse('b6', 85, true)),
        roast('no-bean', '2026-10-12T10:00:00Z', 7, null),
      ],
      today,
    );
    expect(resting.map((r) => r.id)).toEqual(['soon', 'later']);
    expect(ready.map((r) => r.id)).toEqual(['today', 'earlier']);
  });
});
