// Who drank a brew, as shares of it (docs/api/stats.md §11, "How the client
// counts"; backlog 67). A cold brew batch with servings splits by the
// concentrate each drinker was poured; any other brew splits equally among
// whoever it was for. Unit-tested in shares.test.ts.
import type { StatsBrew } from '../api/types';

export const ME = 'me'; // whoever logged it (a serving: whoever logged that)
export const UNNAMED = 'unnamed'; // guests without a name, together
export type Drinker = string; // ME, UNNAMED or a guest id

type Shared = Pick<StatsBrew, 'forMe' | 'guestIds' | 'unnamedGuests' | 'servings'>;

// Each drinker's share, adding up to 1.
export function brewShares(b: Shared): Map<Drinker, number> {
  const out = new Map<Drinker, number>();
  const add = (k: Drinker, n: number) => out.set(k, (out.get(k) ?? 0) + n);
  const poured = b.servings.reduce((n, s) => n + s.concentrateGrams, 0);
  if (poured > 0) {
    for (const s of b.servings) add(s.forGuest ? (s.guestId ?? UNNAMED) : ME, s.concentrateGrams / poured);
    return out;
  }
  const n = (b.forMe ? 1 : 0) + b.guestIds.length + b.unnamedGuests;
  if (n === 0) return out.set(ME, 1);
  if (b.forMe) add(ME, 1 / n);
  for (const g of b.guestIds) add(g, 1 / n);
  if (b.unnamedGuests) add(UNNAMED, b.unnamedGuests / n);
  return out;
}

// The share counted as drunk by whoever logged it.
export const myShare = (b: Shared): number => brewShares(b).get(ME) ?? 0;
// A brew made, at least partly, for someone else.
export const forOthers = (b: Shared): boolean => myShare(b) < 1;

export interface DrinkerTotal {
  key: Drinker;
  brews: number; // brews they had a share of
  ml: number;
  estimated: boolean; // some of the volume is an estimate
  mg: number;
}

// Totals per drinker: ME first, then named guests by volume, unnamed last.
export function drinkerTotals(
  brews: readonly StatsBrew[],
  volume: (b: StatsBrew) => { ml: number; source: string } | null,
  caffeineMg: (b: StatsBrew) => number,
): DrinkerTotal[] {
  const totals = new Map<Drinker, DrinkerTotal>();
  for (const b of brews) {
    const v = volume(b);
    const mg = caffeineMg(b);
    for (const [key, share] of brewShares(b)) {
      if (share <= 0) continue;
      const t = totals.get(key) ?? { key, brews: 0, ml: 0, estimated: false, mg: 0 };
      t.brews += 1;
      t.ml += (v?.ml ?? 0) * share;
      t.estimated ||= v?.source === 'estimate';
      t.mg += mg * share;
      totals.set(key, t);
    }
  }
  const rank = (k: Drinker) => (k === ME ? 0 : k === UNNAMED ? 2 : 1);
  return [...totals.values()].sort((a, b) => rank(a.key) - rank(b.key) || b.ml - a.ml);
}
