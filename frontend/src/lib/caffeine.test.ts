import { describe, expect, it } from 'vitest';
import type { CoffeeSpecies, StatsBrew } from '../api/types';
import { brewCaffeineMg, caffeineSummary, formatCaffeine } from './caffeine';

const filter = { doseGrams: 15, waterGrams: 250 };
const shot = { doseGrams: 18, waterGrams: null };
const bean = (species: CoffeeSpecies[] | null, decaf = false) => ({ species, decaf });

describe('brewCaffeineMg', () => {
  it('works from the dose, the species and the method', () => {
    expect(brewCaffeineMg(filter, bean(['arabica']))).toBeCloseTo(162);
    expect(brewCaffeineMg(shot, bean(['robusta']))).toBeCloseTo(316.8);
  });

  it('averages the species of a blend', () => {
    expect(brewCaffeineMg(shot, bean(['arabica', 'robusta']))).toBeCloseTo(244.8);
  });

  it('counts no species, an empty list or no bean as caffeinated arabica', () => {
    expect(brewCaffeineMg(filter, bean(null))).toBeCloseTo(162);
    expect(brewCaffeineMg(filter, bean([]))).toBeCloseTo(162);
    expect(brewCaffeineMg(filter)).toBeCloseTo(162);
  });

  it('leaves about 3% in a decaf', () => {
    expect(brewCaffeineMg(filter, bean(['arabica'], true))).toBeCloseTo(4.86);
  });
});

describe('formatCaffeine', () => {
  it('rounds to 5 mg, and shows grams from 1000 mg', () => {
    expect(formatCaffeine(162)).toBe('≈ 160 mg');
    expect(formatCaffeine(244.8)).toBe('≈ 245 mg');
    expect(formatCaffeine(0.4)).toBe('≈ 0 mg');
    expect(formatCaffeine(998)).toBe('≈ 1.0 g');
    expect(formatCaffeine(12_400)).toBe('≈ 12.4 g');
  });
});

describe('caffeineSummary', () => {
  const brew = (timestamp: string): StatsBrew => ({ beanId: 'b', doseGrams: 10, waterGrams: 200, timestamp, utcOffsetMinutes: 0 }) as StatsBrew;
  const brews = [brew('2026-10-01T08:00:00.000Z'), brew('2026-10-10T08:00:00.000Z')];
  const beanOf = () => bean(['arabica']);
  const open = { from: null, to: null };

  it('is null with no brews', () => {
    expect(caffeineSummary([], beanOf, open, '2026-10-10')).toBeNull();
  });

  it('totals the brews and averages per brew', () => {
    const s = caffeineSummary(brews, beanOf, open, '2026-10-10')!;
    expect(s.totalMg).toBeCloseTo(216);
    expect(s.perBrewMg).toBeCloseTo(108);
  });

  it('an open period runs from the first brew to today, quiet days included', () => {
    const s = caffeineSummary(brews, beanOf, open, '2026-10-20')!;
    expect(s.days).toBe(20);
    expect(s.perDayMg).toBeCloseTo(10.8);
  });

  it('a set period counts all its days, and stops at today', () => {
    expect(caffeineSummary(brews, beanOf, { from: '2026-09-21', to: '2026-10-20' }, '2026-10-20')!.days).toBe(30);
    expect(caffeineSummary(brews, beanOf, { from: '2026-10-01', to: '2026-12-31' }, '2026-10-20')!.days).toBe(20);
    expect(caffeineSummary(brews, beanOf, { from: '2026-10-01', to: '2026-10-05' }, '2026-10-20')!.days).toBe(5);
  });

  it('a single day counts as one', () => {
    expect(caffeineSummary(brews.slice(0, 1), beanOf, open, '2026-10-01')!.days).toBe(1);
  });
});
