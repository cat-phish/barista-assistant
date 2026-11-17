import { describe, expect, it } from 'vitest';
import type { StatsBrew } from '../api/types';
import { brewShares, drinkerTotals, forOthers, ME, myShare, UNNAMED } from './shares';

const brew = (over: Partial<StatsBrew> = {}): StatsBrew => ({ ...({ id: 'b', forMe: true, guestIds: [], unnamedGuests: 0, servings: [], doseGrams: 15 } as unknown as StatsBrew), ...over });

describe('brew shares (stats.md §11, backlog 67)', () => {
  it('a brew of your own is all yours', () => {
    expect([...brewShares(brew())]).toEqual([[ME, 1]]);
    expect(forOthers(brew())).toBe(false);
  });

  it('splits equally among whoever it was for, unnamed guests together', () => {
    const b = brew({ guestIds: ['sam'], unnamedGuests: 2 });
    expect(Object.fromEntries(brewShares(b))).toEqual({ [ME]: 0.25, sam: 0.25, [UNNAMED]: 0.5 });
    expect(myShare(brew({ forMe: false, guestIds: ['sam'] }))).toBe(0);
    expect(forOthers(b)).toBe(true);
  });

  it("a batch's servings decide its split, by concentrate poured", () => {
    const b = brew({
      forMe: false,
      guestIds: ['alex'],
      servings: [
        { guestId: null, forGuest: false, concentrateGrams: 100 },
        { guestId: 'sam', forGuest: true, concentrateGrams: 50 },
        { guestId: null, forGuest: true, concentrateGrams: 50 },
      ],
    });
    expect(Object.fromEntries(brewShares(b))).toEqual({ [ME]: 0.5, sam: 0.25, [UNNAMED]: 0.25 });
  });

  it('totals per drinker: you first, then guests by volume, unnamed last', () => {
    const brews = [brew({ id: 'a' }), brew({ id: 'b', guestIds: ['sam'], unnamedGuests: 1 }), brew({ id: 'c', forMe: false, guestIds: ['alex'] })];
    const volume = (b: StatsBrew) => (b.id === 'c' ? { ml: 300, source: 'yield' } : { ml: 300, source: 'estimate' });
    const totals = drinkerTotals(brews, volume, () => 90);
    expect(totals.map((t) => t.key)).toEqual([ME, 'alex', 'sam', UNNAMED]);
    expect(totals[0]).toEqual({ key: ME, brews: 2, ml: 400, estimated: true, mg: 120 });
    expect(totals[1]).toEqual({ key: 'alex', brews: 1, ml: 300, estimated: false, mg: 90 });
  });
});
