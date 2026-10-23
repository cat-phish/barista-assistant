import { describe, expect, it } from 'vitest';
import type { Brewer, Grinder, MachineCapabilities } from '../api/types';
import { adjustmentLabel, burrLabel, grinderForm, grinderSummary, machineSummary, parseGrinderForm, pickCopyBrewer, powerLabel, RECIPE_STYLES, STYLES_BY_KIND } from './equipment';

const c40: Grinder = {
  id: 'g', name: 'C40', notes: null, adjustment: 'stepped', settingMin: 0, settingMax: 40, stepSize: 1,
  burrType: 'conical', burrSizeMm: 39, power: 'manual', archivedAt: null, createdAt: '2026-10-20T00:00:00.000Z',
};

describe('grinder form', () => {
  it('round-trips a grinder and blanks become null', () => {
    const { id: _id, archivedAt: _archived, createdAt: _added, ...fields } = c40;
    expect(parseGrinderForm(grinderForm(c40)).values).toEqual(fields);
    expect(parseGrinderForm({ ...grinderForm(), name: ' Niche ' }).values).toMatchObject({ name: 'Niche', adjustment: null, settingMin: null, burrSizeMm: null });
  });

  it('checks the range is a pair in order, and the numbers', () => {
    const base = { ...grinderForm(), name: 'G' };
    expect(parseGrinderForm({ ...base, settingMin: '0' }).errors.range).toMatch(/both ends/);
    expect(parseGrinderForm({ ...base, settingMin: '10', settingMax: '5' }).errors.range).toMatch(/more than/);
    expect(parseGrinderForm({ ...base, stepSize: '0' }).errors.stepSize).toBeTruthy();
    expect(parseGrinderForm({ ...base, burrSizeMm: '38.5' }).errors.burrSizeMm).toBeTruthy();
    expect(parseGrinderForm({ ...base, name: ' ' }).errors.name).toBe('Required');
  });
});

describe('summaries', () => {
  it('describe what is recorded', () => {
    expect(grinderSummary(c40)).toBe('Stepped · 0–40, 1 per step · Conical 39 mm · Hand grinder');
    expect(grinderSummary({ ...c40, adjustment: null, settingMin: null, settingMax: null, stepSize: null, burrType: null, burrSizeMm: null, power: null })).toBe('');
    const m: MachineCapabilities = { preinfusion: 'manual', flowControl: 'manual', pressureControl: 'none' };
    expect(machineSummary(m)).toBe('Pre-infusion: manual · Flow: manual');
    expect(machineSummary({ ...m, preinfusion: 'none', flowControl: 'none' })).toBe('No pre-infusion, flow or pressure control');
  });
});

describe('duplicating a recipe', () => {
  const brewer = (id: string, kind: Brewer['kind'], archivedAt: string | null = null) =>
    ({ id, kind, archivedAt }) as Brewer;
  it('starts on another active brewer of the same kind, else the original', () => {
    const original = { id: 'dl', kind: 'espresso' } as const;
    expect(pickCopyBrewer([brewer('dl', 'espresso'), brewer('v60', 'filter'), brewer('lm', 'espresso')], original)).toBe('lm');
    expect(pickCopyBrewer([brewer('dl', 'espresso'), brewer('old', 'espresso', '2026-01-01')], original)).toBe('dl');
    expect(pickCopyBrewer([], original)).toBe('dl');
  });
});

describe('grinder table cells', () => {
  it('shows power, burrs and adjustment, or null when not set', () => {
    expect([powerLabel(c40), burrLabel(c40), adjustmentLabel(c40)]).toEqual(['Hand', 'Conical 39 mm', 'Stepped · 0–40']);
    const bare: Grinder = { ...c40, adjustment: null, settingMin: null, settingMax: null, burrType: null, burrSizeMm: null, power: null };
    expect([powerLabel(bare), burrLabel(bare), adjustmentLabel(bare)]).toEqual([null, null, null]);
    expect(burrLabel({ ...bare, burrSizeMm: 64 })).toBe('Burrs 64 mm');
    expect(adjustmentLabel({ ...bare, adjustment: 'stepless' })).toBe('Stepless');
    expect(powerLabel({ ...bare, power: 'electric' })).toBe('Electric');
  });
});

describe('recipe styles', () => {
  it('each brew method offers its own styles, all labelled', () => {
    expect(STYLES_BY_KIND.filter).toEqual(['pour_over', 'immersion', 'hybrid', 'cold_brew', 'other']);
    expect(STYLES_BY_KIND.espresso).toEqual(['standard', 'soup', 'other']);
    for (const st of [...STYLES_BY_KIND.filter, ...STYLES_BY_KIND.espresso]) expect(RECIPE_STYLES[st]).toBeTruthy();
  });
});
