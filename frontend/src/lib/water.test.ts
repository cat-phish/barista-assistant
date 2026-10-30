import { describe, expect, it } from 'vitest';
import type { WaterProfile } from '../api/types';
import { defaultWaterProfileId, parseWaterForm, waterForm, waterSummary } from './water';

const profile = (over: Partial<WaterProfile> = {}): WaterProfile => ({
  id: 'w1', name: 'TWW', notes: null, isDefault: false, archivedAt: null, createdAt: '2026-10-22T00:00:00.000Z',
  tdsPpm: 150, generalHardnessPpm: 102, alkalinityPpm: 0, calciumPpm: null, magnesiumPpm: null, sodiumPpm: null,
  potassiumPpm: null, bicarbonatePpm: null, chloridePpm: null, sulfatePpm: null, ph: 7.2, ...over,
});

describe('water profile form', () => {
  it('round-trips a profile; blank figures are null', () => {
    const { values, errors } = parseWaterForm(waterForm(profile({ notes: 'per gallon' })));
    expect(errors).toEqual({});
    expect(values).toMatchObject({ name: 'TWW', notes: 'per gallon', tdsPpm: 150, alkalinityPpm: 0, calciumPpm: null, ph: 7.2 });
  });

  it('needs a name and checks every figure', () => {
    const { errors, values } = parseWaterForm({ ...waterForm(), name: ' ', calciumPpm: '-3', magnesiumPpm: '1.234', ph: '15', tdsPpm: '12,5' });
    expect(values).toBeNull();
    expect(Object.keys(errors).sort()).toEqual(['calciumPpm', 'magnesiumPpm', 'name', 'ph']);
  });
});

describe('water labels and defaults', () => {
  it('summarises the recorded figures', () => {
    expect(waterSummary(profile())).toBe('TDS 150 · GH 102 · KH 0 · pH 7.2');
  });

  it('starts new brews on the active default, else none', () => {
    expect(defaultWaterProfileId([profile(), profile({ id: 'w2', isDefault: true })])).toBe('w2');
    expect(defaultWaterProfileId([profile({ isDefault: true, archivedAt: '2026-10-22T00:00:00.000Z' })])).toBe('');
    expect(defaultWaterProfileId([])).toBe('');
  });
});
