import { describe, expect, it } from 'vitest';
import { jarGrams, jarRatio, overallRatio } from './batch';
import type { BrewServing } from '../api/types';
import { emptyServingDraft, FOR_ME, FOR_UNNAMED, parseServingDraft, ratioText, servingAmounts, servingDraftFrom, servingForText, suggestWater } from './servingDraft';

const now = new Date('2026-11-10T15:00:00.000Z');
const draft = (fields: Partial<ReturnType<typeof emptyServingDraft>> = {}) => ({ ...emptyServingDraft(now), ...fields });

describe('parseServingDraft', () => {
  it('needs what was poured; water is optional and decides diluted with', () => {
    expect(parseServingDraft(draft(), now).errors.poured).toBeTruthy();
    const neat = parseServingDraft(draft({ poured: '120', dilutedWith: 'milk' }), now).values;
    expect(neat).toMatchObject({ concentrateGrams: 120, diluentGrams: null, dilutedWith: null, tastingNotes: null });
    const milk = parseServingDraft(draft({ poured: '120,5', water: '90', dilutedWith: 'milk', notes: ' Rich ', rating: 4, flavors: ['sweet'] }), now).values;
    expect(milk).toMatchObject({ concentrateGrams: 120.5, diluentGrams: 90, dilutedWith: 'milk', tastingNotes: 'Rich', rating: 4, flavors: ['sweet'] });
  });
  it('checks the numbers, the time and an unweighed batch yield', () => {
    const r = parseServingDraft(draft({ poured: '0', water: '-1', when: '2026-11-11T15:00', batchYield: 'x' }), now);
    expect(Object.keys(r.errors).sort()).toEqual(['batchYield', 'poured', 'water', 'when']);
    expect(parseServingDraft(draft({ poured: '100', batchYield: '310' }), now).batchYieldGrams).toBe(310);
  });
});

describe('who drank it', () => {
  const sam = { id: 'sam', name: 'Sam' };
  it('starts from the batch: me, its only named guest, or a guest', () => {
    expect(emptyServingDraft(now).forWho).toBe(FOR_ME);
    expect(emptyServingDraft(now, { forMe: true, guests: [sam], unnamedGuests: 0 }).forWho).toBe(FOR_ME);
    expect(emptyServingDraft(now, { forMe: false, guests: [sam], unnamedGuests: 0 }).forWho).toBe('sam');
    expect(emptyServingDraft(now, { forMe: false, guests: [sam], unnamedGuests: 1 }).forWho).toBe(FOR_UNNAMED);
  });
  it('sends forGuest and the guest, and reads them back', () => {
    const at = (forWho: string) => parseServingDraft(draft({ poured: '100', forWho }), now).values;
    expect(at(FOR_ME)).toMatchObject({ forGuest: false, guestId: null });
    expect(at(FOR_UNNAMED)).toMatchObject({ forGuest: true, guestId: null });
    expect(at('sam')).toMatchObject({ forGuest: true, guestId: 'sam' });
    const s = { concentrateGrams: 100, diluentGrams: null, dilutedWith: null, timestamp: now.toISOString(), rating: null, flavors: [], tastingNotes: null } as unknown as BrewServing;
    expect(servingDraftFrom({ ...s, forGuest: true, guestId: 'sam', guest: sam }).forWho).toBe('sam');
    expect(servingDraftFrom({ ...s, forGuest: true, guestId: null, guest: null }).forWho).toBe(FOR_UNNAMED);
    expect(servingDraftFrom({ ...s, forGuest: false, guestId: null, guest: null }).forWho).toBe(FOR_ME);
  });
  it('says who it was for', () => {
    expect(servingForText({ forGuest: false, guest: null })).toBeNull();
    expect(servingForText({ forGuest: true, guest: null })).toBe('For a guest');
    expect(servingForText({ forGuest: true, guest: sam })).toBe('For Sam');
  });
});

describe('dilution', () => {
  it('suggests the glass water from the served dilution, unless the jar is diluted', () => {
    expect(suggestWater(120, 1, false)).toBe('120');
    expect(suggestWater(120, 1.5, false)).toBe('180');
    expect(suggestWater(120, 1, true)).toBe('');
    expect(suggestWater(120, null, false)).toBe('');
  });
  it('works out the glass as drunk with a jar diluted 1:1', () => {
    const j = jarRatio(310, 310);
    expect(j).toBe(1);
    expect(jarGrams(310, 310)).toBe(620);
    expect(overallRatio(240, 0, j)).toBe(1); // poured as is
    expect(overallRatio(120, 120, j)).toBe(3); // 60 g concentrate, 60 + 120 water
    expect(overallRatio(120, 120, 0)).toBe(1);
    expect(overallRatio(120, null, 0)).toBeNull();
  });
  it('says it in words', () => {
    expect(ratioText(1.5)).toBe('1 : 1.5');
    expect(ratioText(null)).toBe('neat');
    expect(servingAmounts({ concentrateGrams: 120, diluentGrams: 90, dilutedWith: 'milk' })).toBe('120 g + 90 g milk');
    expect(servingAmounts({ concentrateGrams: 240, diluentGrams: 0, dilutedWith: null })).toBe('240 g');
  });
});
